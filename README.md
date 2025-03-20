# HFRA - Hetzner Forgejo Runner Autoscaler

This service autoscales Forgejo Runners on Hetzner down to zero. This achieves somewhat efficient scheduling of jobs and a cost reduction of up to 50 times at running jobs compared to Github Actions.

> Note: There is an ongoing progress in adding [autoscaling capabilities](https://codeberg.org/forgejo/discussions/issues/241) to Forgejo Runners, which definitely will be more sophisticated than this solution.

## Details

You should have at least one forgejo runner to run light tasks that can make `curl` calls. In the [example.yaml](./examples/test-runner.yaml) it is labeled as *lite* and runs on the same node as forgejo.

The autoscaler guarantees that there will be a requested `needed_runner_type` available for `planned_usage_seconds` within `max_wait_seconds`. All these parameters should be set for the jobs you run, like in the ([example.yaml](./examples/test-runner.yaml)). Since Hetzner servers are priced per hour, once you rent a server it is kept for [MINIMUM_RENT_SECONDS](/.env.example) which is 55 minutes by default. It will then be removed, unless it receives a job, once it has a CPU utilization of less then 10%.

This allows you to rent servers/runners on demand in a range of $0.0088 - $0.6114 per hour on [hetzner](https://www.hetzner.com/cloud/) instead of $0.008 - $0.512 per minute on [github](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions#per-minute-rates-for-x64-powered-larger-runners).

## Setup

### Compile

Clone the repo then compile the code to a [Single-file executable](https://bun.sh/docs/bundler/executables) file (it takes 5 seconds). In case you target ARM arch then change use `--target=bun-linux-arm64`.

```
bun build --compile --target=bun-linux-x64 ./index.ts --outfile hrfa
```

### Configure

Copy the [.env.example](.env.example) to the target server's (where you'll run the hrfa service) `/etc/hfra/.env` and configure it's variables:

- **HFRA_URL** is where you'll run the hfra service, runners will notify this url when they are idle
- **SERVER_NAME_PREFIX** will be prepended to the name of the rented hetzner node
- **RUNNER_SSH_KEYS**, **RUNNER_FIREWALL** and **RUNNER_NETWORK** should be set using their IDs (not their names). This [firewall](https://console.hetzner.cloud/projects/1212121/firewalls/12345678/rules) corresponds to the firewall with `12345678` key.

The remaining variables are self explanatory, once you configured the .env file, you can check them locally usin the available [calls](./examples/calls.md). It is assumed that you will provide only internal access to the hfra service, at HFRA_URL and HFRA_PORT.

### Start

Move the executable file to the target server as `/etc/hfra/hfra`, and copy the [hrfa.service](hfra.service) to `/etc/systemd/system/hrfa.service`, then start and enable it.

```
systemctl enable hfra.service
systemctl start hfra.service
```

## Thanks

Spawning Action Runners was easy to understand thanks to @pierreprinetti's [Forgejo Hetzner Runner](https://codeberg.org/pierreprinetti/forgejo-hetzner-runner) code.
