# Deploy GreenWave on an Oracle Always Free VM

This runs the full simulation-only application on one VM: Caddy (public HTTPS), Next.js,
and one FastAPI worker. No app login, database or paid domain is required.
`compose.production.yaml` is independent of the development `compose.yaml`.

After the first manual launch, follow [GitHub Actions deployment setup](CI.md) to deploy
successful `main` pushes automatically.

## 1. Create the accounts

1. Sign up at [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/). Use your real
   details, verify your email/phone, and provide a supported card for identity verification.
   Oracle may place a temporary authorization hold. Do not upgrade to Pay As You Go for this guide.
2. Choose your **home region carefully**: Always Free compute must be in that region.
   Choose a nearby European region with Ampere A1 availability. Capacity is not guaranteed;
   if provisioning reports no capacity, try another availability domain in the same region or retry later.
3. Sign in to [DuckDNS](https://www.duckdns.org/) and reserve a free, unique hostname such as
   `your-greenwave-name.duckdns.org`. An existing domain you control also works.

Application source and map behavior are preserved from reference commit `0b7729f`.
Deployment adds no map-provider credentials or request/attribution changes.

Oracle's documentation checked on 2026-10-25 lists an A1 free allowance equivalent to **2 OCPUs
and 12 GB RAM**, plus **200 GB combined boot/block storage**. Use the current console's free
eligibility and limits as the final check. The promotional trial credits are separate from
Always Free; don't select a paid shape because the trial temporarily covers it.
Free VMs can be reclaimed when idle, so retain your local source, dataset, and SSH key.
See [Always Free limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
and [signup requirements](https://www.oracle.com/cloud/free/faq/).

DuckDNS is a [free DNS service](https://www.duckdns.org/faqs.jsp).

## 2. Create the VM in Oracle

In **Compute → Instances → Create instance**:

- Name: `greenwave-demo`.
- Image: an Always Free eligible **Ubuntu 24.04 ARM64** image.
- Shape: **VM.Standard.A1.Flex**, **2 OCPUs / 12 GB RAM**, within your total free allowance.
- Boot volume: keep the default, approximately **50 GB**; do not enable paid storage options.
- Networking: a VCN with a **public subnet**, an internet gateway and route, and a **public IPv4 address**.
- SSH: supply your own public key, or generate a key pair and download the private key.
  Keep the private key on your computer; never put it in this repository or chat.
- Review the resource estimate and free eligibility before creating. Don't add a load balancer,
  managed database, or extra paid resources.

Record the VM's public IPv4 address. In its subnet's security list (or attached network
security group), allow **TCP 80 and 443 from `0.0.0.0/0`**, and **TCP 22 from your own public
IP `/32`** for SSH. Keep 3000 and 8000 closed. Only Caddy publishes application ports.
If an attached Ubuntu host firewall blocks 80/443, allow those ports there too; retain SSH
access and existing Oracle firewall rules. Do not flush the firewall.

Update the DuckDNS hostname's IPv4 value to the VM's public IP. Do not add an IPv6/AAAA
record unless IPv6 routing and firewall access also work. Confirm DNS from your computer:

```bash
nslookup your-greenwave-name.duckdns.org
```

If the VM's IP changes later, update DNS before restarting or renewing HTTPS.

## 3. Connect and install Docker

**On your computer**, store the downloaded key at the example path below (or adjust the path).
Replace the example IP with the VM's public IPv4 address:

```bash
chmod 600 ~/.ssh/greenwave-oracle.key
ssh -i ~/.ssh/greenwave-oracle.key ubuntu@YOUR_VM_PUBLIC_IP
```

**On the VM**, install Docker Engine and the Compose plugin using
[Docker's Ubuntu installation guide](https://docs.docker.com/engine/install/ubuntu/).
Select the Ubuntu apt-repository method and install `docker-ce`, `docker-ce-cli`,
`containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin`.
This does not require a Docker Hub account. Then:

```bash
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
sudo apt-get update
sudo apt-get install -y rsync
mkdir -p ~/GreenWave/backend/data/raw ~/GreenWave/backend/data/processed
```

Use `sudo docker` throughout this guide; adding your account to the Docker group is unnecessary.

## 4. Upload this branch and the prepared dataset

The deployment branch can be copied directly from your computer. No GitHub account, push,
or public source repository is needed. The server needs the complete processed directory and
its matching manifest; it does **not** need the 299 MB raw-data bundle just to run.

**On your computer, from the GreenWave repository root**, first confirm the expected branch:

```bash
git branch --show-current
# Use main with the deployment commits, or the deployment revision you intend to release.
```

Upload the source without credentials, caches, agent state or large input data:

```bash
rsync -av -e 'ssh -i ~/.ssh/greenwave-oracle.key' \
  --exclude '.git/' --exclude 'node_modules/' --exclude '.venv/' \
  --exclude '.next/' --exclude '__pycache__/' --exclude '.tmp/' \
  --exclude '.agent/' --exclude '.agents/' --exclude '.claude/' --exclude '.codex/' \
  --exclude '.superpowers/' --exclude 'graphify-out/' \
  --exclude '.env' --exclude '.env*.local' \
  --exclude 'backend/data/raw/' --exclude 'backend/data/processed/' \
  ./ ubuntu@YOUR_VM_PUBLIC_IP:~/GreenWave/

rsync -av -e 'ssh -i ~/.ssh/greenwave-oracle.key' \
  backend/data/processed/ ubuntu@YOUR_VM_PUBLIC_IP:~/GreenWave/backend/data/processed/

rsync -av -e 'ssh -i ~/.ssh/greenwave-oracle.key' \
  backend/data/raw/MANIFEST.json ubuntu@YOUR_VM_PUBLIC_IP:~/GreenWave/backend/data/raw/
```

Stop local ETL before copying so the artifacts stay consistent. Include `etl_report.json`,
`ids.json`, the quality summary, stations, addresses, and all other processed files; do not
pick only individual Parquet files. The backend validates hashes and refuses stale/missing data.
If the local dataset is missing, follow [the backend ETL guide](../backend/README.md) locally
(including `places` and `quality`) before uploading.

## 5. Configure the deployment on the VM

**On the VM**:

```bash
cd ~/GreenWave
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
```

Edit `deploy/.env` with `nano deploy/.env`:

```dotenv
DOMAIN=your-greenwave-name.duckdns.org
ACME_EMAIL=your-real-email@example.com
```

Use a hostname only for `DOMAIN`, without `https://`, a path, or trailing slash. The real environment file is
gitignored; don't commit or share it. The containers read the dataset as UID 10001, so ensure
uploaded files are readable and their parent directories traversable (ordinary 644 files / 755
directories work; do not use 777).

## 6. Build and launch

**On the VM, from `~/GreenWave`**:

```bash
sudo docker compose --env-file deploy/.env -f compose.production.yaml config --quiet
sudo docker compose --env-file deploy/.env -f compose.production.yaml up -d --build --wait
sudo docker compose --env-file deploy/.env -f compose.production.yaml ps
```

The first build downloads locked dependencies and can take several minutes. Backend and frontend
healthchecks must pass before Caddy starts. Caddy obtains and renews the public HTTPS certificate
automatically once DNS and ports 80/443 work. Certificate issuance can continue after `--wait`
returns; inspect proxy logs if HTTPS is not ready yet.

Open **`https://your-greenwave-name.duckdns.org`**. The app is public and has no login prompt.
HTTP redirects to HTTPS. Don't expose the plain frontend/backend ports as a workaround.

`NEXT_PUBLIC_*` settings are built into the frontend image. The production Compose file always
selects backend transport and derives the API origin from `DOMAIN`. Changing the hostname or
API origin requires rebuilding the frontend with `up -d --build`.

## 7. Verify the public app

From your computer, without credentials:

```bash
curl --fail https://your-greenwave-name.duckdns.org/api/v1/health
# Expected: {"status":"ok"}

curl --fail https://your-greenwave-name.duckdns.org/api/v1/stations
# Expected: a nonempty stations array

curl -I https://your-greenwave-name.duckdns.org/
# Expected: 200. The health GET above must return status=ok.
```

In the browser:

1. Check that the map loads in light and dark themes and attribution is visible.
2. Search an address, rank stations, and start an enabled simulation. Confirm moving telemetry
   updates every simulated second; test Stop and start another run in standard mode.
3. Run the comparison workflow and check both results and replay.
4. Open diagnostics and the phone driver route, including on a phone over mobile data.
5. In browser Network tools, confirm `/api/v1/simulation/<id>/stream` receives
   `text/event-stream` events continuously without collecting them into delayed batches.

The app has **one shared active operation**, not independent visitor sessions. A new run can
supersede another visitor's run. Keep a single backend container and **one Uvicorn worker**.
Restarts/deployments lose in-memory sessions; this is the existing PoC behavior. Visitors share
the public simulation; there are no separate users or session storage.

## Logs and common failures

```bash
sudo docker compose --env-file deploy/.env -f compose.production.yaml logs --tail=100 backend frontend proxy
sudo docker stats --no-stream
df -h
```

- **Backend unhealthy:** check data paths, permissions, manifest hashes, and the named ETL recovery
  instruction. Re-upload a complete matching dataset; there is no mock fallback.
- **HTTPS unavailable:** check DNS (including stale AAAA records), the VM's public IP, OCI rules,
  the host firewall, and Caddy logs. Don't repeatedly request certificates while DNS is wrong.
- **Map unavailable:** inspect failed basemap requests and provider availability. The app uses
  the reference commit's existing map requests; deployment does not add map authentication.
- **Backend unreachable in UI:** rebuild after `DOMAIN` changes. The browser must call your
  public HTTPS hostname, never `localhost:8000` or a Compose service name.
- **Disk fills after updates:** inspect `sudo docker system df`; remove only identified unused
  images after retaining a rollback image. Don't prune volumes containing certificates.

Logs rotate at 10 MB × 3 per service. Caddy stores certificate/account state in named volumes.
No paid load balancer, database, Kubernetes cluster, or container registry is needed.

## Updates, backup and rollback

Before updating, on the VM, find the active source directory from Compose's container label
and save the currently running application images. This also works after moving a release
out of the original `~/GreenWave` directory:

```bash
GREENWAVE_ACTIVE_RELEASE=$(sudo docker inspect greenwave-backend-1 \
  --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}')
cd "$GREENWAVE_ACTIVE_RELEASE"
GREENWAVE_BACKUP_DIR="${GREENWAVE_ACTIVE_RELEASE}-backup-$(date +%Y%m%d-%H%M%S)"
sudo docker image tag greenwave-backend:latest greenwave-backend:rollback
sudo docker image tag greenwave-frontend:latest greenwave-frontend:rollback
cp -a "$GREENWAVE_ACTIVE_RELEASE" "$GREENWAVE_BACKUP_DIR"
printf 'Rollback source/data/config: %s\n' "$GREENWAVE_BACKUP_DIR"
```

Record the printed backup path. This backup contains the private environment file: keep it
private. Retain an off-VM copy of the processed data and its matching
manifest, plus the source revision and configuration. Existing local copies can serve this purpose.
Oracle documents a limited free volume-backup allowance; verify eligibility before enabling backups.

For each release, upload source into a **fresh directory** using step 4, copy the matching dataset
and private environment file into it, then run step 6 there. Compose's fixed project name `greenwave`
replaces the existing stack and reuses its certificate volumes. Don't run two versions simultaneously.
Keep the old directory to avoid obsolete files remaining after source deletions. Expect a short
interruption and loss of active simulations during updates.

To roll back, return to the recorded backup directory and retag the saved images. If you opened
a new SSH session, set `GREENWAVE_BACKUP_DIR` to that recorded absolute path first:

```bash
cd "$GREENWAVE_BACKUP_DIR"
sudo docker image tag greenwave-backend:rollback greenwave-backend:latest
sudo docker image tag greenwave-frontend:rollback greenwave-frontend:latest
sudo docker compose --env-file deploy/.env -f compose.production.yaml up -d --no-build --wait
```

Do not overwrite the rollback tags again until the new release passes step 7.

**Known limitation:** rolling back the images does not roll back the data. The backend reads the
processed data of the directory it runs from (`./backend/data/processed`, bind-mounted read-only),
and step 4's commands write to `~/GreenWave`. If a new dataset (for example a rebuilt
`etl_report.json`) was uploaded into the active directory instead of a fresh one, the rollback
images read that new data. Roll back only from the backup directory, which holds the previous
dataset.

To stop without deleting certificate state:

```bash
sudo docker compose --env-file deploy/.env -f compose.production.yaml down
```

Avoid `down --volumes` for routine updates. Keep Ubuntu and container base images current;
`docker compose ... build --pull` refreshes application bases and
`docker compose ... pull proxy` refreshes Caddy (replace `...` with the flags used above).

## Boundary of local verification

Container checks cannot prove Oracle capacity, public DNS, ACME issuance, map-provider availability, or
phone connectivity before those resources exist. Run step 7 after provisioning. Hosting the
app does not connect it to real signals: all routes, signal states, ITS feedback, and priority
commands remain simulated.
