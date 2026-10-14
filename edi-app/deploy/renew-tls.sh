#!/bin/sh
set -eu
exec 9>/run/lock/alpaca-tls.lock
flock -n 9 || exit 0
docker run --rm --memory=256m --cpus=0.5 \
  -v /opt/alpaca/letsencrypt:/etc/letsencrypt -v /opt/alpaca/acme:/var/www/acme \
  certbot/certbot:v5.5.0 renew --non-interactive --no-random-sleep-on-renew --cert-name edi.scadasystem.io "$@"
live=/opt/alpaca/letsencrypt/live/edi.scadasystem.io
if ! cmp -s "$live/fullchain.pem" /opt/alpaca/secrets/nginx/edi.crt; then
  install -m 640 -o root -g 101 "$live/privkey.pem" /opt/alpaca/secrets/nginx/edi.key
  install -m 640 -o root -g 101 "$live/fullchain.pem" /opt/alpaca/secrets/nginx/edi.crt
  docker exec alpaca-web-1 nginx -t
  docker exec alpaca-web-1 nginx -s reload
fi
