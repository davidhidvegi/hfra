import { Database } from "bun:sqlite";

console.log("Starting HFRA runner manager");

const db = new Database("runners.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS runners (
    id TEXT PRIMARY KEY,
    hostname TEXT NOT NULL,
    server_type TEXT NOT NULL,
    runner_label TEXT NOT NULL,
    safe_until NUMBER NOT NULL
  )
`);

const HETZNER_API_TOKEN = Bun.env.HETZNER_API_TOKEN
const FORGEJO_URL = Bun.env.FORGEJO_URL;
const HFRA_URL = Bun.env.HFRA_URL;
const HFRA_PORT = Bun.env.HFRA_PORT || 3001;
const MINIMUM_RENT_SECONDS = parseInt(Bun.env.MINIMUM_RENT_SECONDS || '3300');
const RUNNER_BITS_URL_START = Bun.env.RUNNER_BITS_URL_START
const RUNNER_BITS_ARM_SHA256 = Bun.env.RUNNER_BITS_ARM_SHA256 || ""
const RUNNER_BITS_AMD_SHA256 = Bun.env.RUNNER_BITS_AMD_SHA256 || ""
const SERVER_NAME_PREFIX = Bun.env.SERVER_NAME_PREFIX || 'hfra-runner';
const RUNNER_TOKEN = Bun.env.RUNNER_TOKEN
const RUNNER_SSH_KEYS = Bun.env.RUNNER_SSH_KEYS?.split(",").map(Number) || []
const RUNNER_LOCATION = Bun.env.RUNNER_LOCATION || "hel1"
const RUNNER_FIREWALL = Bun.env.RUNNER_FIREWALL || 0
const RUNNER_NETWORK = Bun.env.RUNNER_NETWORK || 0
const cloud_init_yaml = (runner_name:string, server_type: string, runner_label: string) => `#cloud-config
runcmd:
- sed -i -e '/^\(#\|\)PermitRootLogin/s/^.*$/PermitRootLogin no/' /etc/ssh/sshd_config
- sed -i -e '/^\(#\|\)PasswordAuthentication/s/^.*$/PasswordAuthentication no/' /etc/ssh/sshd_config
- sed -i -e '/^\(#\|\)KbdInteractiveAuthentication/s/^.*$/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
- sed -i -e '/^\(#\|\)ChallengeResponseAuthentication/s/^.*$/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
- sed -i -e '/^\(#\|\)MaxAuthTries/s/^.*$/MaxAuthTries 2/' /etc/ssh/sshd_config
- sed -i -e '/^\(#\|\)AllowTcpForwarding/s/^.*$/AllowTcpForwarding no/' /etc/ssh/sshd_config
- sed -i -e '/^\(#\|\)X11Forwarding/s/^.*$/X11Forwarding no/' /etc/ssh/sshd_config
- sed -i -e '/^\(#\|\)AllowAgentForwarding/s/^.*$/AllowAgentForwarding no/' /etc/ssh/sshd_config
- sed -i -e '/^\(#\|\)AuthorizedKeysFile/s/^.*$/AuthorizedKeysFile .ssh\/authorized_keys/' /etc/ssh/sshd_config
- systemctl enable hfra-runner.service
- systemctl start hfra-runner.service
write_files:
- content: |
    HFRA_URL="${HFRA_URL}"
    FORGEJO_URL="${FORGEJO_URL}"
    RUNNER_TOKEN=${RUNNER_TOKEN}
    RUNNER_NAME="${runner_name}"
    RUNNER_LABEL="${runner_label}"
  owner: root:root
  path: /root/.env
  permissions: '0644'
- content: |
    #!/bin/bash
    source /root/.env

    apt update
    apt upgrade -y
    if [ ! -x "$(command -v docker)" ]; then
        curl -fsSL test.docker.com -o get-docker.sh && sh get-docker.sh
    fi

    if [ ! -f /usr/bin/forgejo-runner ]; then
        curl -sSL ${RUNNER_BITS_URL_START}-${server_type.startsWith("cax") ? "arm" : "amd"}64  > /usr/bin/forgejo-runner
        echo '${server_type.startsWith("cax") ? RUNNER_BITS_ARM_SHA256 : RUNNER_BITS_AMD_SHA256}  /usr/bin/forgejo-runner' | sha256sum -c && chmod +x /usr/bin/forgejo-runner
    fi
    mkdir -p /etc/runner
    cd /etc/runner
    if [ ! -f .runner ]; then
        /usr/bin/forgejo-runner register --no-interactive --token $RUNNER_TOKEN --name $RUNNER_NAME --instance $FORGEJO_URL --labels $RUNNER_LABEL
    fi
    if [ ! -f config.yml ]; then
        /usr/bin/forgejo-runner generate-config > /etc/runner/config.yml
    fi
    systemctl start runner.service

    echo "Monitor CPU usage and notify hfra"
    CPU_PERC_AVG=100.0
    while true; do
        CPU_PERC_CURRENT=$(top -bn1 | grep "Cpu(s)" | awk '{print 100 - $8}')
        if [ "$(echo "$CPU_PERC_CURRENT == 100" | bc -l)" -eq 1 ]; then
            CPU_PERC_CURRENT=0.0
        fi
        CPU_PERC_AVG=$(echo "(29 * $CPU_PERC_AVG + $CPU_PERC_CURRENT) / 30" | bc -l)
        if [ "$(echo "$CPU_PERC_AVG < 10" | bc -l)" -eq 1 ]; then
            curl -X POST -H "Content-Type: application/json" -d '{"hostname": "'$(hostname)'"}' "\${HFRA_URL}/api/unused-runner"
        fi
        sleep 1
    done
  owner: root:root
  path: /root/hfra-runner.sh
  permissions: '0644'
- content: |
    [Unit]
    Description=hfra runner
    Wants=network.target
    After=network.target

    [Service]
    Type=simple
    User=root
    Group=root
    WorkingDirectory=/root
    ExecStart=bash /root/hfra-runner.sh
    Restart=on-failure
    RestartSec=5

    [Install]
    WantedBy=multi-user.target
  owner: root:root
  path: /etc/systemd/system/hfra-runner.service
  permissions: '0644'
- content: |
    [Unit]
    Description=Forgejo runner
    Wants=network.target
    After=network.target

    [Service]
    Type=simple
    User=root
    Group=root
    WorkingDirectory=/etc/runner
    ExecStart=/usr/bin/forgejo-runner daemon
    Restart=on-failure
    RestartSec=5

    [Install]
    WantedBy=multi-user.target
  owner: root:root
  path: /etc/systemd/system/runner.service
  permissions: '0644'
`

interface RunnerData {
    id: string; // id of server at hetzner
    hostname: string; // hostname of the runner
    server_type: string; // cax11
    runner_label: string; // shared-arm-xs:docker://catthehacker/ubuntu:act-22.04
    safe_until: number; // timestamp
}

interface RunnerNeedQuery {
    needed_runner_type: keyof typeof needed_runner_type_to_server_type; // shared-arm-xs
    planned_usage_seconds: number; // 300 (10 minutes) 
    max_wait_seconds: number;// 1800 (30 minutes) 
}

interface RunnerReportQuery {
    hostname: string; // hostname of the runner
}

const needed_runner_type_to_server_type = {
    "shared-arm-xs": "cax11",
    "shared-arm-s": "cax21",
    "shared-arm-m": "cax31",
    "shared-arm-l": "cax41",
    "shared-amd-xs": "cpx11",
    "shared-amd-s": "cpx21",
    "shared-amd-m": "cpx31",
    "shared-amd-l": "cpx41",
    "shared-amd-xl": "cpx51",
    "shared-intel-xs": "cx22",
    "shared-intel-s": "cx32",
    "shared-intel-m": "cx42",
    "shared-intel-l": "cx52",
    "dedicated-intel-xs": "ccx13",
    "dedicated-intel-s": "ccx23",
    "dedicated-intel-m": "ccx33",
    "dedicated-intel-l": "ccx43",
    "dedicated-intel-xl": "ccx53",
    "dedicated-intel-xxl": "ccx63",
}

const server_type_to_runner_label = {
    "cax11": "shared-arm-xs:docker://catthehacker/ubuntu:act-22.04",
    "cax21": "shared-arm-s:docker://catthehacker/ubuntu:act-22.04",
    "cax31": "shared-arm-m:docker://catthehacker/ubuntu:act-22.04",
    "cax41": "shared-arm-l:docker://catthehacker/ubuntu:act-22.04",
    "cpx11": "shared-amd-xs:docker://catthehacker/ubuntu:act-22.04",
    "cpx21": "shared-amd-s:docker://catthehacker/ubuntu:act-22.04",
    "cpx31": "shared-amd-m:docker://catthehacker/ubuntu:act-22.04",
    "cpx41": "shared-amd-l:docker://catthehacker/ubuntu:act-22.04",
    "cpx51": "shared-amd-xl:docker://catthehacker/ubuntu:act-22.04",
    "cx22": "shared-intel-xs:docker://catthehacker/ubuntu:act-22.04",
    "cx32": "shared-intel-s:docker://catthehacker/ubuntu:act-22.04",
    "cx42": "shared-intel-m:docker://catthehacker/ubuntu:act-22.04",
    "cx52": "shared-intel-l:docker://catthehacker/ubuntu:act-22.04",
    "ccx13": "dedicated-intel-xs:docker://catthehacker/ubuntu:act-22.04",
    "ccx23": "dedicated-intel-s:docker://catthehacker/ubuntu:act-22.04",
    "ccx33": "dedicated-intel-m:docker://catthehacker/ubuntu:act-22.04",
    "ccx43": "dedicated-intel-l:docker://catthehacker/ubuntu:act-22.04",
    "ccx53": "dedicated-intel-xl:docker://catthehacker/ubuntu:act-22.04",
    "ccx63": "dedicated-intel-xxl:docker://catthehacker/ubuntu:act-22.04"
}

async function createRunner(server_type: string, runner_label: string) {
    const URL = "https://api.hetzner.cloud/v1/servers";
    const server_name = `${SERVER_NAME_PREFIX}-${server_type}-${Math.random().toString(36).substring(2, 10)}`;
    const response = await fetch(URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + HETZNER_API_TOKEN,
        },
        body: JSON.stringify({
            "name": server_name,
            "server_type": server_type,
            "image": "ubuntu-24.04",
            "labels": { "role": "runner" },
            "ssh_keys": RUNNER_SSH_KEYS,
            "location": RUNNER_LOCATION,
            "firewalls": [{"firewall": RUNNER_FIREWALL}],
            "networks": [RUNNER_NETWORK],
            "start_after_create": true,
            "public_net": {"enable_ipv4":true,"enable_ipv6":true},
            "user_data": cloud_init_yaml(server_name, server_type, runner_label),
        }),
    });
    if (!response.ok) {
        console.log(`createRunner error:\n\n${await response.text()}`);
        return [null, null];
    }
    else {
        return await response.json().then((data: any) => {
            if (!data.server) {
                console.log(`createRunner error, data.server doesn't exist, data:\n\n${JSON.stringify(data, null, 2)}`);
                return [null, null];
            }
            return [data.server.id, server_name];
        });
    }
}
async function getRunner(runnerHostname: string) {
    if (!runnerHostname.startsWith(SERVER_NAME_PREFIX)) {
        return null;
    }
    const URL = "https://api.hetzner.cloud/v1/servers?name=" + runnerHostname;
    const resp = await fetch(URL, {
        method: "GET",
        headers: { "Authorization": "Bearer " + HETZNER_API_TOKEN },
    });
    await resp.json().then((data: any) => {
        if (data.server) {
            return data.server.id;
        }
        else return null;
    });
}
async function deleteRunner(runnerId: string) {
    const URL = "https://api.hetzner.cloud/v1/servers/" + runnerId;
    return await fetch(URL, {
        method: "DELETE",
        headers: { "Authorization": "Bearer " + HETZNER_API_TOKEN },
    });
}

function getTimeInSeconds() {
    return new Date().getTime() / 1000;
}

Bun.serve({
    port: HFRA_PORT,
    routes: {
        "/api/status": new Response("OK"),

        "/api/need-runner": {
            POST: async req => {
                const runner_need = await req.json() as RunnerNeedQuery;
                console.log(`need-runner API called, requests ${runner_need.needed_runner_type} for ${runner_need.planned_usage_seconds} seconds with max wait of ${runner_need.max_wait_seconds} seconds`);
                const current_time = getTimeInSeconds();
                const safe_until = current_time + runner_need.planned_usage_seconds;
                const server_type = needed_runner_type_to_server_type[runner_need.needed_runner_type];
                const runner_label = server_type_to_runner_label[server_type as keyof typeof server_type_to_runner_label];

                const oldest_runner = db.query(
                    `SELECT * FROM runners WHERE server_type = ? AND runner_label = ? ORDER BY safe_until ASC LIMIT 1`,
                ).get(server_type, runner_label) as RunnerData | null;
                if (oldest_runner && oldest_runner.safe_until < current_time + runner_need.max_wait_seconds) {
                    db.query(
                        `UPDATE runners SET safe_until = ? WHERE id = ?`,
                    ).run(Math.max(oldest_runner.safe_until, current_time) + runner_need.planned_usage_seconds, oldest_runner.id);
                    return new Response("OK");
                }
                
                const new_server = await createRunner(server_type, runner_label);
                const new_safe_until = Math.max(current_time + MINIMUM_RENT_SECONDS, safe_until);
                const id = new_server[0];
                const server_name = new_server[1];
                if (!id || !server_name) {
                    return new Response("Failed to create the server", { status: 500 });
                }
                db.query(
                    `INSERT INTO runners (id, hostname, server_type, runner_label, safe_until)
                    VALUES (?, ?, ?, ?, ?)`,
                ).run(id, server_name, server_type, runner_label, new_safe_until);
                return new Response("OK");
            },
        },

        "/api/unused-runner": {
            POST: async req => {
                const runner_report = await req.json() as RunnerReportQuery;
                console.log(`runner API called, ${runner_report.hostname} is unused`);

                var runner = db.query(
                    `SELECT * FROM runners WHERE hostname = ?`,
                ).get(runner_report.hostname) as RunnerData | null;
                if (runner && runner.safe_until > getTimeInSeconds()) {
                    return new Response("OK");
                }
                else {
                    db.query(
                        `DELETE FROM runners WHERE hostname = ?`,
                    ).run(runner_report.hostname);

                    if (runner) {
                        const response = await deleteRunner(runner.id);
                        if (!response.ok) {
                            return new Response("Failed to delete the server", { status: 500 });
                        }
                    }
                    else {
                        const runnerId = await getRunner(runner_report.hostname);
                        if (runnerId) {
                            const response = await deleteRunner(runnerId);
                            if (!response.ok) {
                                return new Response("Failed to delete the server", { status: 500 });
                            }
                        }
                    }
                    return new Response("OK");
                }
            },
        },
    },
});