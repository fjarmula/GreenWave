# Automatic Oracle deployments from GitHub Actions

After this one-time setup, pushing or merging to `main` runs the existing quality checks and
deploys the tested commit to your Oracle VM. The workflow lives in `.github/workflows/ci.yml`.
No self-hosted runner, container registry, or extra Oracle service is required.

The existing application must already run under the fixed Compose project name `greenwave`.
This guide uses your confirmed `ubuntu` account and `/home/ubuntu/GreenWave` installation.

## What happens on each main push

1. Commit policy, graph generation, backend, frontend, contract drift, and deployment tests run.
2. After all pass, one deployment job connects through SSH with a dedicated key and pinned host key.
3. It uploads a Git archive of the tested commit. It never uploads an environment file or GIS data.
   The deployment script is uploaded separately and executed from a file with SSH stdin closed,
   so a container preflight cannot consume the remaining deployment commands.
4. The VM creates `~/GreenWave/releases/<commit-sha>/` and links its existing config and dataset.
5. It builds ARM64 images on the VM, using distinct commit tags, and validates the new backend's
   dataset and routing startup against the real mounts before replacing any container.
6. Compose waits for application health; public homepage/API probes must return 200 and health
   JSON must report `status=ok`. A 401 login challenge is a deployment failure.
7. If activation fails, the script tries to restore the previous release without rebuilding it.
   The Actions job remains failed so you know the new release did not go live.

Pull requests only run checks. Obsolete commits are skipped when main has already advanced.
Deployments are serialized; a new push does not cancel a deployment halfway through.
Active simulations are still lost on restart. Expect a short interruption during replacement.

Standard GitHub-hosted runners are free for public repositories. Private repositories use your
included Actions minutes and can incur charges beyond the allowance; check your billing limits.
See [GitHub runner pricing rules](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

## 1. Check the existing installation

On the VM, over your normal SSH connection:

```bash
test -f /home/ubuntu/GreenWave/deploy/.env
test -f /home/ubuntu/GreenWave/backend/data/raw/MANIFEST.json
test -d /home/ubuntu/GreenWave/backend/data/processed
sudo -n docker inspect greenwave-backend-1 \
  --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'
sudo -n docker compose version
command -v python3 curl tar flock
```

The inspect command must print a real source directory containing `compose.production.yaml`
and `deploy/.env`. `sudo -n` must work without prompting. Ubuntu's `flock` comes from `util-linux`.
If the earlier installation failed, complete the [manual launch](README.md) first.

## 2. Create a dedicated deployment SSH key

On your **computer**, generate a new key; don't reuse the Oracle administrator private key:

```bash
ssh-keygen -t ed25519 -C greenwave-github-actions \
  -f ~/.ssh/greenwave-actions_ed25519 -N ''
cat ~/.ssh/greenwave-actions_ed25519.pub
```

Keep the private key out of the repository and chat. On the **VM**, add the printed public key
as a new line in `/home/ubuntu/.ssh/authorized_keys`, prefixed with `restrict`:

```text
restrict ssh-ed25519 YOUR_GENERATED_PUBLIC_KEY greenwave-github-actions
```

Keep the existing administrator key. Ensure `~/.ssh` has mode 700 and `authorized_keys` mode 600.
The restricted key allows noninteractive commands/SFTP but disables forwarding and a pseudo-TTY.
It can deploy as `ubuntu`, including that account's passwordless Docker sudo access; treat the
GitHub secret as privileged access to the VM. Only trusted main-branch code should deploy.

Before proceeding, test from your computer:

```bash
ssh -T -i ~/.ssh/greenwave-actions_ed25519 ubuntu@YOUR_VM_PUBLIC_IP 'sudo -n docker version'
```

## 3. Permit the GitHub runner to connect

The original Oracle setup allowed port 22 only from your computer's IP. GitHub-hosted runner
addresses change, so that rule alone cannot support automatic deployments. GitHub discourages
maintaining its large, changing runner IP ranges as an allowlist.

For the simplest free setup, allow TCP **22 from `0.0.0.0/0`** in the VM's OCI security list/NSG,
using **key-only SSH**. This makes SSH internet-reachable, while authentication still requires a
private key. First, keep your current SSH session open and configure on the VM:

```bash
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' | \
  sudo tee /etc/ssh/sshd_config.d/00-greenwave-ci.conf > /dev/null
sudo sshd -t
sudo systemctl reload ssh
sudo sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) '
```

Confirm all three values print `no`. Open a second SSH session with your key before closing the
first. Then add the OCI ingress rule, and adjust an active Ubuntu firewall if it still restricts
SSH to your computer's IP. Keep ports 3000 and 8000 closed; HTTPS still uses ports 80/443.

If you want port 22 to remain restricted to private access, don't enable this workflow yet:
the transport needs a VPN or a separately secured runner with network access. Do not disable
host-key verification to troubleshoot a connection timeout.
See [GitHub's runner IP guidance](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#ip-addresses).

## 4. Record the VM's trusted host key

Through your **already trusted SSH session** or Oracle's console, read the public host key:

```bash
sudo cat /etc/ssh/ssh_host_ed25519_key.pub
```

Create one known_hosts line using the same hostname/IP that GitHub will use:

```text
YOUR_VM_PUBLIC_IP ssh-ed25519 THE_VM_HOST_PUBLIC_KEY
```

Use the VM's key here, not the deployment user's key from step 2. For a custom SSH port, the
first field must be `[YOUR_VM_PUBLIC_IP]:PORT`. Obtain this through the trusted connection;
blindly accepting `ssh-keyscan` output from an unverified host defeats the pinning.

## 5. Configure the GitHub production environment

Open [repository settings](https://github.com/fjarmula/GreenWave/settings/environments):

1. **Settings → Environments → New environment**, name it **`production`**.
2. Under deployment branches/tags, allow only **`main`**.
3. Leave required reviewers/wait timers off if deployment must run without a manual approval.
4. Add these **environment secrets**:

| Secret | Value |
| --- | --- |
| `OCI_SSH_PRIVATE_KEY` | Complete contents of `~/.ssh/greenwave-actions_ed25519`, including BEGIN/END lines |
| `OCI_SSH_KNOWN_HOSTS` | The trusted host-key line from step 4 |

5. Add these **environment variables**:

| Variable | Value |
| --- | --- |
| `OCI_HOST` | VM public IPv4 address or SSH hostname, without a URL prefix |
| `OCI_USER` | `ubuntu` (also the default) |
| `OCI_DEPLOY_ROOT` | `/home/ubuntu/GreenWave` (also the default; absolute path, no spaces) |
| `OCI_SSH_PORT` | `22` (also the default) |

The hostname, certificate email and dataset remain in the existing server installation;
they do not need GitHub secrets. Don't paste the whole server `.env` into GitHub.

Finally, under **Settings → Secrets and variables → Actions → Variables**, add a
**repository variable** (not an environment variable):

```text
OCI_DEPLOY_ENABLED = true
```

This is deliberately a repository-level switch: the deploy job checks it before entering the
production environment. Without it, CI runs normally and deployment is skipped.
GitHub documents [environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
and [Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

## 6. Publish the local changes and verify the first deployment

Once the settings are ready, **from your local repository**:

```bash
git status
git push origin main
```

The deployment branch was renamed locally to `feat/oracle-deployment` and merged into local
main, preserving the newer commits already on origin/main. No force push is needed. If GitHub
requires a PR instead of direct main pushes, follow that branch-protection policy.

Open **Actions → CI Pipeline**. After the quality jobs pass, **Deploy to Oracle** should run.
Check its last log line for the deployed SHA and previous release directory. On the VM:

```bash
readlink -f ~/GreenWave/current
sudo docker compose --env-file ~/GreenWave/current/deploy/.env \
  --env-file ~/GreenWave/current/deploy/images.env \
  -f ~/GreenWave/current/compose.production.yaml ps
```

Then test the public site as in [the manual verification steps](README.md#7-verify-the-public-app).
A green Actions run verifies service health and public HTTPS access; you should still check
map loading and a short simulation on the first deployment.

Every later push or merge to main repeats this automatically after successful checks.
For a failed connection, fix the settings and **Re-run all jobs** for the latest main revision.
Re-running a revision that is already active leaves its images unchanged. To rebuild the same
source against a changed server configuration or newer base images, create a new main commit
or perform a deliberate manual rebuild; reruns do not mutate an active release's image tags.

## Failures and rollback

- **Deploy skipped:** check `OCI_DEPLOY_ENABLED` is a repository variable equal to `true`, the
  event is a main push, and all checks passed. Superseded revisions are intentionally skipped.
- **SSH timeout:** verify OCI and host-firewall ingress, port and public IP. An admin-only IP
  allowlist does not allow a standard GitHub-hosted runner.
- **Host-key failure:** verify the server identity through the trusted admin connection and
  update the pinned secret if the VM was rebuilt. Do not turn off StrictHostKeyChecking.
- **Build or dataset preflight failure:** the old service remains running; check disk space,
  build logs, and the canonical dataset validation error.
- **Activation failure:** the job attempts rollback and remains red. Inspect the log for
  `Rollback restored` or `ROLLBACK FAILED`; a failed rollback requires manual recovery.

For manual rollback, disable automatic deployment first by changing `OCI_DEPLOY_ENABLED` to
`false`. Wait until any running deploy job finishes. Use the previous release directory printed
in its log (replace the path below with that exact directory):

```bash
cd /home/ubuntu/GreenWave/releases/PREVIOUS_COMMIT_SHA
sudo docker compose --env-file deploy/.env --env-file deploy/images.env \
  -f compose.production.yaml up -d --no-build --wait
ln -sfn "$PWD" /home/ubuntu/GreenWave/current
```

For the original manual installation at `~/GreenWave`, omit the second `--env-file` if it has
no `deploy/images.env`. Never rebuild during rollback: each release's images.env selects its
original commit-tagged images. Re-enable deployment only after fixing/reverting main, or the
next successful main push will deploy that main version again.

## Data and disk retention

The original `~/GreenWave/deploy/.env`, `backend/data/processed/` and raw manifest are shared
inputs. Keep that directory even when the active source moves into `releases/`. Replacing data
remains a deliberate manual task: validate a matching complete dataset before restarting.
Changing `DOMAIN` needs a new frontend build, triggered by a new main commit.
Application source, configuration and map requests match reference commit `0b7729f`;
the production Dockerfile packages it with Next's standard server without changing app source.

Each successful deployment retains its source archive, release directory and uniquely tagged
images so rollback works. Monitor `df -h` and `sudo docker system df`. After verification,
remove only specifically identified old archives/releases/images, retaining the active release
and at least one known-good rollback. No automatic deletion or broad Docker volume prune is
performed. Never delete Caddy volumes, shared configuration/data, or an active release.
