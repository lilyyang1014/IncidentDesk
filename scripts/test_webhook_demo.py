import datetime
import json
import unittest
from unittest.mock import Mock, patch

import webhook_demo as demo

TOKEN = "00000000-0000-4000-8000-000000000000." + "a" * 64
OK = json.dumps({"success": True, "data": {"recordId": "webhook:fixture", "duplicate": False}}).encode()


class WebhookDemoTests(unittest.TestCase):
    def test_retry_retains_exact_bytes_and_honors_retry_after(self):
        send = Mock(side_effect=[OSError("private text"), (429, "12", b""), (201, None, OK)])
        sleep, report = Mock(), Mock()
        demo.deliver(TOKEN, b'{"eventId":"stable"}', send, sleep, report)
        self.assertEqual(send.call_count, 3)
        self.assertTrue(all(call.args == (TOKEN, b'{"eventId":"stable"}') for call in send.call_args_list))
        self.assertEqual(sleep.call_args_list[1].args, (12,))
        self.assertNotIn("private text", str(report.call_args_list))
        self.assertNotIn(TOKEN, str(report.call_args_list))

    def test_duplicate_is_confirmed(self):
        response = OK.replace(b'false', b'true')
        demo.deliver(TOKEN, b'{}', Mock(return_value=(200, None, response)), Mock(), Mock())

    def test_refusals_and_redirects_do_not_retry(self):
        for status in (301, 302, 307, 308, 400, 401, 403, 409, 410, 413, 415):
            with self.subTest(status=status):
                send = Mock(return_value=(status, None, b"secret-like response"))
                with self.assertRaisesRegex(ValueError, "Delivery refused"):
                    demo.deliver(TOKEN, b'{}', send, Mock(), Mock())
                self.assertEqual(send.call_count, 1)

    def test_unconfirmed_success_is_not_accepted(self):
        for response in (b'{}', b'not json', b'null', b'{"success":true,"data":null}'):
            with self.subTest(response=response), self.assertRaisesRegex(ValueError, "Unconfirmed"):
                demo.deliver(TOKEN, b'{}', Mock(return_value=(201, None, response)), Mock(), Mock())

    def test_exhaustion_is_bounded(self):
        send, sleep = Mock(return_value=(503, None, b'')), Mock()
        with self.assertRaisesRegex(ValueError, "3 attempts"):
            demo.deliver(TOKEN, b'{}', send, sleep, Mock())
        self.assertEqual(send.call_count, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_long_or_invalid_retry_after_stops_without_early_retry(self):
        for header in ("86400", "invalid"):
            send, sleep = Mock(return_value=(429, header, b'')), Mock()
            with self.assertRaises(ValueError):
                demo.deliver(TOKEN, b'{}', send, sleep, Mock())
            sleep.assert_not_called()
            self.assertEqual(send.call_count, 1)

    def test_missing_secret_never_sends(self):
        send = Mock()
        with self.assertRaisesRegex(ValueError, "secret"):
            demo.deliver("", b'{}', send)
        send.assert_not_called()

    def test_payload_identity_changes_on_workflow_rerun(self):
        env = dict(GITHUB_REPOSITORY="owner/repo", GITHUB_REPOSITORY_ID="1",
                   GITHUB_RUN_ID="2", GITHUB_RUN_ATTEMPT="1")
        now = datetime.datetime.now(datetime.timezone.utc)
        event = json.loads(demo.payload(env, now))
        self.assertEqual(event['eventId'], 'github:1:2:1')
        self.assertEqual(event['sourceUrl'], 'https://github.com/owner/repo/actions/runs/2')
        env['GITHUB_RUN_ATTEMPT'] = '2'
        self.assertNotEqual(event['eventId'], json.loads(demo.payload(env, now))['eventId'])
        env['GITHUB_REPOSITORY'] = 'bad\ncontext'
        with self.assertRaises(ValueError):
            demo.payload(env, now)

    def test_transport_has_fixed_destination_timeout_and_closes(self):
        with patch.object(demo.http.client, 'HTTPSConnection') as factory:
            connection = factory.return_value
            connection.getresponse.return_value.status = 307
            demo.request(TOKEN, b'{}')
            factory.assert_called_once_with('incidentdesk.app.space', timeout=15)
            self.assertEqual(connection.request.call_args.args[:3],
                             ('POST', '/api/webhooks/incidents', b'{}'))
            connection.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
