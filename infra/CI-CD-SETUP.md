# CI/CD Setup — GitHub Actions → GCP (Workload Identity Federation)

Goal: wire `.github/workflows/deploy.yml` to deploy automatically with **no long-lived
keys** — GitHub Actions authenticates to GCP via OIDC (Workload Identity Federation,
"WIF"), impersonating short-lived tokens for two purpose-built service accounts.

**Status: done for `dev`, verified 2026-09-05.** `kevinxsanjula@gmail.com` was granted
`roles/owner` on `travelcrm-506818`, which unblocked every step below — all of Part 1
has been run against the real project, Part 2 verification passed, and Part 3's six
GitHub repo secrets/variables are set. Part 4's workflow edit is in this same PR.

This doc is kept as the **runbook for replicating the same setup against `staging`
and `prod`** later (new pool/provider per environment, or a shared pool with
per-environment SAs — decide when those environments are actually provisioned).

---

## Part 1 — Owner-only steps

Run in order. Each has a `gcloud` command and an equivalent Console path. All are
idempotent-safe (creating something that already exists just errors harmlessly;
nothing here deletes or overwrites existing resources).

Project: `travelcrm-506818` (project number `288052100062`), region `asia-south1`.

### 1.1 Create the WIF pool

```bash
gcloud iam workload-identity-pools create github-actions-pool \
  --project=travelcrm-506818 \
  --location=global \
  --display-name="GitHub Actions Pool" \
  --description="Federates GitHub Actions OIDC tokens for LushWare/Travel-Cloud CI/CD"
```

**Console:** IAM & Admin → Workload Identity Federation → *Create Pool*
- Name: `github-actions-pool`, Display name: `GitHub Actions Pool` → Continue (provider added in 1.2) → Save.

### 1.2 Create the WIF provider (OIDC, scoped to this repo)

```bash
gcloud iam workload-identity-pools providers create-oidc github-actions-provider \
  --project=travelcrm-506818 \
  --location=global \
  --workload-identity-pool=github-actions-pool \
  --display-name="GitHub Actions Provider" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository_owner=='LushWare-Org'"
```

**Console:** same Pool page → *Add Provider*
- Provider type: `OpenID Connect (OIDC)`
- Provider name: `github-actions-provider`
- Issuer URL: `https://token.actions.githubusercontent.com`
- Attribute mapping: `google.subject = assertion.sub`, `attribute.repository = assertion.repository`, `attribute.repository_owner = assertion.repository_owner`, `attribute.ref = assertion.ref`
- Attribute condition: `assertion.repository_owner=='LushWare-Org'`

The `attribute_condition` is a hard safety gate — without it, *any* GitHub repo anywhere
could federate into this pool if they somehow got the provider's resource name.

### 1.3 Create the CI/CD deploy service account

> Skip if `kevinxsanjula@gmail.com` already created it — SA creation itself doesn't
> need Owner, only the role grants below do. Check first:
> `gcloud iam service-accounts list --project=travelcrm-506818 --filter="email:github-actions-deployer*"`

```bash
gcloud iam service-accounts create github-actions-deployer \
  --project=travelcrm-506818 \
  --display-name="GitHub Actions CI/CD deployer (Cloud Run + Artifact Registry)"
```

**Console:** IAM & Admin → Service Accounts → *Create Service Account*
- Name: `github-actions-deployer` → Create and continue (skip role grant here, done in 1.4) → Done.

### 1.4 Grant the deploy SA exactly the roles it needs (project-level)

Minimal set for `build-and-push` + `deploy` jobs: push images, deploy Cloud Run
revisions, and act-as the per-service runtime SAs (Cloud Run deploy requires the
deploying principal to have `iam.serviceAccounts.actAs` on whichever SA the revision
runs as — every `dev-<service>@...` SA already exists from Terraform).

```bash
PROJECT=travelcrm-506818
SA=github-actions-deployer@${PROJECT}.iam.gserviceaccount.com

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:${SA}" --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:${SA}" --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:${SA}" --role="roles/iam.serviceAccountUser"
```

**Console:** IAM & Admin → IAM → *Grant Access* → Principal: `github-actions-deployer@travelcrm-506818.iam.gserviceaccount.com` → Roles: `Cloud Run Admin`, `Artifact Registry Writer`, `Service Account User` → Save.

### 1.5 Grant the existing Firebase Hosting deployer SA its role

`firebase-hosting-deployer@travelcrm-506818.iam.gserviceaccount.com` already exists
(created in an earlier session) but has zero roles — this is the exact grant that's
been blocked since then.

```bash
gcloud projects add-iam-policy-binding travelcrm-506818 \
  --member="serviceAccount:firebase-hosting-deployer@travelcrm-506818.iam.gserviceaccount.com" \
  --role="roles/firebasehosting.admin"
```

**Console:** IAM & Admin → IAM → *Grant Access* → Principal: `firebase-hosting-deployer@travelcrm-506818.iam.gserviceaccount.com` → Role: `Firebase Hosting Admin` → Save.

### 1.6 Let the WIF pool impersonate both service accounts

This is the actual federation link: it tells GCP "a GitHub Actions run from
`LushWare/Travel-Cloud` may mint short-lived tokens as this SA." Scoped to this one
repo via the `attribute.repository` condition — no other repo can use it.

```bash
PROJECT_NUMBER=288052100062
REPO="LushWare/Travel-Cloud"
MEMBER="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions-pool/attribute.repository/${REPO}"

gcloud iam service-accounts add-iam-policy-binding \
  github-actions-deployer@travelcrm-506818.iam.gserviceaccount.com \
  --project=travelcrm-506818 \
  --role="roles/iam.workloadIdentityUser" \
  --member="$MEMBER"

gcloud iam service-accounts add-iam-policy-binding \
  firebase-hosting-deployer@travelcrm-506818.iam.gserviceaccount.com \
  --project=travelcrm-506818 \
  --role="roles/iam.workloadIdentityUser" \
  --member="$MEMBER"
```

**Console:** for each SA — Service Accounts → click the SA → *Permissions* tab →
*Grant Access* → Principal: paste the `principalSet://...` string above → Role:
`Workload Identity User` → Save.

### 1.7 Hand back the WIF provider's resource name

Whoever does the above, run this and send the single output line back — it's the
value for the `GCP_WIF_PROVIDER` GitHub secret in Part 3:

```bash
gcloud iam workload-identity-pools providers describe github-actions-provider \
  --project=travelcrm-506818 --location=global \
  --workload-identity-pool=github-actions-pool \
  --format="value(name)"
```

Expected shape: `projects/288052100062/locations/global/workloadIdentityPools/github-actions-pool/providers/github-actions-provider`

---

## Part 2 — Verify (operator, once Part 1 is done)

```bash
gcloud iam workload-identity-pools providers describe github-actions-provider \
  --project=travelcrm-506818 --location=global \
  --workload-identity-pool=github-actions-pool

gcloud iam service-accounts get-iam-policy github-actions-deployer@travelcrm-506818.iam.gserviceaccount.com
gcloud iam service-accounts get-iam-policy firebase-hosting-deployer@travelcrm-506818.iam.gserviceaccount.com
gcloud projects get-iam-policy travelcrm-506818 --flatten="bindings[].members" \
  --filter="bindings.members:github-actions-deployer OR bindings.members:firebase-hosting-deployer"
```

Expect: the provider describe succeeds; both `get-iam-policy` calls show a
`roles/iam.workloadIdentityUser` binding to the `principalSet://...` member; the
project policy shows `github-actions-deployer` with `run.admin` /
`artifactregistry.writer` / `iam.serviceAccountUser`, and `firebase-hosting-deployer`
with `firebasehosting.admin`.

---

## Part 3 — GitHub repo secrets & variables

Operator can set these directly (`gh secret set` / `gh variable set` already verified
working at **repo level** — no GitHub Environment needs to exist first; repo-level
secrets/vars are visible as a fallback to every job regardless of which `environment:`
it targets). Set at: `Settings → Secrets and variables → Actions` in the repo, or via CLI.

**Never paste real secret values into any committed file, chat log, or issue — set
them directly via `gh secret set` (reads stdin/prompt, not stored anywhere) or the
Console's masked input field.**

| Name | Type | Value | Where it comes from |
|---|---|---|---|
| `GCP_WIF_PROVIDER` | secret | `projects/288052100062/locations/global/workloadIdentityPools/github-actions-pool/providers/github-actions-provider` | Output of step 1.7 |
| `GCP_DEPLOY_SA` | secret | `github-actions-deployer@travelcrm-506818.iam.gserviceaccount.com` | Step 1.3 |
| `SUPABASE_DIRECT_URL` | secret | same value as `direct_url` in `infra/terraform/deployments/dev/terraform.tfvars` (gitignored, already on this machine) | existing local file |
| `GCP_PROJECT_ID` | **variable** (not secret — not sensitive) | `travelcrm-506818` | — |
| `GCP_REGION` | **variable** | `asia-south1` | — |
| `GATEWAY_URL` | **variable** | `https://dev-gateway-fbystisnzq-el.a.run.app/api/v1` | current live gateway URL |

CLI form (run from repo root, each prompts for the secret value on stdin so it never
appears in shell history or `ps`):

```bash
gh secret set GCP_WIF_PROVIDER --repo LushWare/Travel-Cloud
gh secret set GCP_DEPLOY_SA --repo LushWare/Travel-Cloud
gh secret set SUPABASE_DIRECT_URL --repo LushWare/Travel-Cloud

gh variable set GCP_PROJECT_ID --repo LushWare/Travel-Cloud --body "travelcrm-506818"
gh variable set GCP_REGION --repo LushWare/Travel-Cloud --body "asia-south1"
gh variable set GATEWAY_URL --repo LushWare/Travel-Cloud --body "https://dev-gateway-fbystisnzq-el.a.run.app/api/v1"
```

`FIREBASE_SERVICE_ACCOUNT` (used by today's `deploy-hosting` job) is **not needed** if
we switch that job to WIF too — see Part 4. If you'd rather keep it key-based, that's
a separate, weaker path (a static JSON key) not covered here.

---

## Part 4 — One workflow edit (after Parts 1–3 are done)

`deploy-hosting` in `.github/workflows/deploy.yml` currently authenticates with a
static JSON key (`secrets.FIREBASE_SERVICE_ACCOUNT` + `credentials_json`). Once
`firebase-hosting-deployer` is WIF-bound (step 1.6), switch it to match the other two
jobs — same pattern, zero stored keys anywhere in the whole pipeline:

```yaml
      - name: Authenticate to Google Cloud with Firebase service account
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
          service_account: firebase-hosting-deployer@travelcrm-506818.iam.gserviceaccount.com
```

(replacing the existing `credentials_json: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}` step)

`google-github-actions/auth@v2` exports `GOOGLE_APPLICATION_CREDENTIALS` either way,
so `firebase-tools` picks up the WIF-derived credentials automatically — no other
change needed in that job.

---

## Part 5 — Terraform CI (`terraform.yml`): plan automatic, apply manual-only

A third service account, separate from the two above on purpose: `github-actions-deployer`
and `firebase-hosting-deployer` are deliberately scoped to "push images / deploy revisions" —
giving either of them Terraform's actual needs (create service accounts, set IAM policy on
secrets and Cloud Run services, manage Secret Manager) would quietly undo that least-privilege
split. Terraform gets its own identity and its own blast radius.

### 5.1 Create the Terraform service account

```bash
gcloud iam service-accounts create terraform-deployer \
  --project=travelcrm-506818 \
  --display-name="GitHub Actions Terraform deployer (infra plan/apply)"
```

### 5.2 Grant it the same role set the human operator has used all along

`infra/README.md`'s own "Prerequisites" section documents these four as sufficient for
everything this Terraform module does (Cloud Run, Secret Manager, per-service SAs, IAM
bindings on both) — proven by every `terraform apply` run manually this session:

```bash
PROJECT=travelcrm-506818
SA=terraform-deployer@${PROJECT}.iam.gserviceaccount.com
for ROLE in roles/editor roles/run.admin roles/secretmanager.admin roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:${SA}" --role="$ROLE"
done
```

### 5.3 Bind it to the existing WIF pool (same repo scope as the other two SAs)

```bash
PROJECT_NUMBER=288052100062
MEMBER="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions-pool/attribute.repository/LushWare/Travel-Cloud"
gcloud iam service-accounts add-iam-policy-binding terraform-deployer@travelcrm-506818.iam.gserviceaccount.com \
  --project=travelcrm-506818 --role="roles/iam.workloadIdentityUser" --member="$MEMBER"
```

### 5.4 GitHub secrets

| Name | Value |
|---|---|
| `GCP_WIF_PROVIDER` | The provider resource name from step 1.7; required by `google-github-actions/auth@v2`. |
| `GCP_TERRAFORM_SA` | `terraform-deployer@travelcrm-506818.iam.gserviceaccount.com` |
| `TF_VARS_DEV` | the entire contents of `infra/terraform/deployments/dev/terraform.tfvars` (gitignored locally) — CI writes it to disk verbatim before `terraform init`. Extending to staging/prod later is just adding `TF_VARS_STAGING`/`TF_VARS_PROD` the same way. |

If the auth action says neither `workload_identity_provider` nor `credentials_json`
was provided, `GCP_WIF_PROVIDER` is missing or unavailable to that run. This workflow
uses Workload Identity Federation, not a JSON key. Set the secrets on the
`LushWare/Travel-Cloud` repository, and ensure the provider and service-account IAM
binding both trust the `LushWare/Travel-Cloud` repository claim.

```bash
gh secret set GCP_TERRAFORM_SA --repo LushWare/Travel-Cloud --body "terraform-deployer@travelcrm-506818.iam.gserviceaccount.com"
gh secret set TF_VARS_DEV --repo LushWare/Travel-Cloud < infra/terraform/deployments/dev/terraform.tfvars
```

### 5.5 The pipeline itself (`.github/workflows/terraform.yml`)

- **`plan`** — runs on every PR and push to `main` touching `infra/terraform/**`.
  Read-only: `terraform plan`, posted as a PR comment. Hardcoded to `dev` (the only
  environment with state and a `TF_VARS_*` secret today).
- **`apply`** — `workflow_dispatch` only. A human picks an environment in the Actions UI
  and triggers it; nothing else ever calls this job. Runs a fresh `plan` + `apply` in the
  same run (never applies a plan file from a separate, possibly-stale run).

**Why the image never gets reverted by `apply`, automatic or manual:** the shared
`modules/deployment/modules/cloud-run-service/main.tf` has a
`lifecycle { ignore_changes = [...] }` block excluding the container `image` field
entirely. Terraform sets it once at first creation; after that, CI's `gcloud run deploy`
(in `deploy.yml`) is the sole owner of what's live, regardless of what `image_tag` says
in `terraform.tfvars`. Verified live: temporarily set `image_tag` to a nonsense value and
`terraform plan` still reported "No changes."

**Achievable gate today vs. the ideal one:** the strongest version of "apply is manual"
is a GitHub Environment with a required reviewer — someone has to click approve, not
just trigger. That needs repo-admin GitHub permissions this operator doesn't have (same
wall as the `dev` GitHub Environment in Part 3 — retested, still 403). `workflow_dispatch`-only
is what's achievable now; upgrade to a required-reviewer Environment once repo admin is
available.

---

## Sequence summary (as run for `dev`)

1. ~~**Owner** runs Part 1~~ — done: `kevinxsanjula@gmail.com` had `roles/owner`, ran all 7 steps directly.
2. ~~**Owner** sends back the Part 1.7 output line~~ — captured directly: `projects/288052100062/locations/global/workloadIdentityPools/github-actions-pool/providers/github-actions-provider`.
3. ~~**Operator** runs Part 2 to confirm, then Part 3~~ — done, all 6 secrets/vars set.
4. ~~**Operator** applies the Part 4 workflow edit~~ — done, shipped via `infra/ci-cd-wif-setup` → PR into `microservices`.
5. Next: merge the PR, then trigger `workflow_dispatch` with `environment: dev` (or push
   to `microservices`) and watch the run — first real end-to-end CI/CD deploy.
