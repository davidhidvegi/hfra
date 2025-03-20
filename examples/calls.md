## Check status

```
curl -X POST https://hfra.your.domain.com/api/status
```

## Request a Runner

```
curl -X POST \
-H "Content-Type:application/json" \
-d '{"needed_runner_type":"shared-arm-xs", "planned_usage_seconds":600, "max_wait_seconds":100}' \
https://hfra.your.domain.com/api/need-runner
```

## Notify a Runner's low CPU usage

```
curl -X POST \
-H "Content-Type:application/json" \
-d '{"hostname":"hfra-runner-cax11-1a2b3c4d"}' \
https://hfra.your.domain.com/api/unused-runner
```