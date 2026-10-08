#!/bin/sh
# Read-only NAS inventory. Run a NEW one-time DSM task as root.
# Key registration is a separate task using the intended NAS login account.
set -u
printf 'TASK_EXECUTION_USER=%s\n' "$(id -un)"
if [ "$(id -u)" != "0" ]; then
  printf '%s\n' 'INVENTORY_REQUIRES_ROOT=yes; change only this inventory task to root.'
  exit 1
fi
printf 'CPU_ARCH=%s\n' "$(uname -m)"
if [ -r /etc.defaults/VERSION ]; then
  awk -F= '$1 == "productversion" || $1 == "buildnumber" || $1 == "smallfixnumber" {print "DSM_" $0}' /etc.defaults/VERSION
fi
nas_inventory_docker=$(command -v docker 2>/dev/null || true)
if [ -z "$nas_inventory_docker" ]; then
  for nas_inventory_path in /usr/local/bin/docker /var/packages/ContainerManager/target/usr/bin/docker /var/packages/Docker/target/usr/bin/docker; do
    if [ -x "$nas_inventory_path" ]; then nas_inventory_docker="$nas_inventory_path"; break; fi
  done
fi
if [ -n "$nas_inventory_docker" ]; then
  if nas_inventory_version=$("$nas_inventory_docker" version --format '{{.Server.Version}}' 2>/dev/null) && [ -n "$nas_inventory_version" ]; then
    printf 'DOCKER_SERVER_VERSION=%s\n' "$nas_inventory_version"
    printf '%s\n' 'DOCKER_SERVER_ACCESS=yes'
    nas_inventory_compose=$("$nas_inventory_docker" compose version --short 2>/dev/null || true)
    if [ -n "$nas_inventory_compose" ]; then
      printf 'COMPOSE_VERSION=%s\n' "$nas_inventory_compose"
    elif command -v docker-compose >/dev/null 2>&1; then
      docker-compose --version
    else
      printf '%s\n' 'COMPOSE_VERSION=unavailable'
    fi
    printf '%s\n' 'EXISTING_CONTAINERS_AND_PUBLISHED_PORTS:'
    "$nas_inventory_docker" ps --format '{{.Names}} | {{.Ports}}' || printf '%s\n' 'CONTAINER_LIST=unavailable'
  else
    printf '%s\n' 'DOCKER_SERVER_ACCESS=no; Docker service status needs checking.'
  fi
else
  printf '%s\n' 'DOCKER_CLI_AVAILABLE=no'
fi
nas_inventory_listeners=''
nas_inventory_scan_ok=no
if command -v ss >/dev/null 2>&1; then
  if nas_inventory_listeners=$(ss -lnt 2>/dev/null); then nas_inventory_scan_ok=yes; fi
fi
if [ "$nas_inventory_scan_ok" != yes ] && command -v netstat >/dev/null 2>&1; then
  if nas_inventory_listeners=$(netstat -lnt 2>/dev/null); then nas_inventory_scan_ok=yes; fi
fi
for nas_inventory_port in 3001 13001; do
  printf 'LISTENERS_ON_%s:\n' "$nas_inventory_port"
  if [ "$nas_inventory_scan_ok" = yes ]; then
    nas_inventory_matches=$(printf '%s\n' "$nas_inventory_listeners" | awk -v port="$nas_inventory_port" '$4 ~ (":" port "$") {print $4}')
    if [ -n "$nas_inventory_matches" ]; then
      printf '%s\n' "$nas_inventory_matches"
      printf 'TCP_LISTENER_STATUS_%s=busy\n' "$nas_inventory_port"
    else
      printf 'TCP_LISTENER_STATUS_%s=not_listening\n' "$nas_inventory_port"
    fi
  else
    printf 'TCP_LISTENER_STATUS_%s=unknown\n' "$nas_inventory_port"
  fi
done
printf '%s\n' 'Port status is a snapshot; also review Docker published ports, including ranges.'
for nas_inventory_volume in /volume[0-9]*; do
  if [ -d "$nas_inventory_volume/docker" ]; then
    printf 'EXISTING_DOCKER_DIRECTORY=%s/docker\n' "$nas_inventory_volume"
  fi
done
printf '%s\n' 'READ_ONLY_INVENTORY_COMPLETE; no services or files were changed.'
