# Public app deployment acceptance

The user removed Caddy login in1d31fc1 and wants public access. CI failed because its HTTPS
probe still required401 and rolled back the healthy public200 release to protecteddb5aab7.

Require200 for both public homepage and API health, and validate the health JSON status=ok.
Reject401, other failures and a200 HTML/error page from the health endpoint. Remove commented
basic_auth and unused DEMO credentials from active Compose/env examples and guides. SSH keys
and deployment environment protection remain unchanged. Preserve application source/reference0b.

Test public activation and rollback on invalid responses, validate Compose without demo
credentials, and recover the already-published1d31fc1 release using the corrected probe. Do not
push source or modify the VM's stored secrets/data. Check public HTTP responses after recovery.
