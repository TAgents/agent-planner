FROM postgres:17-alpine

RUN apk add --no-cache \
    bash \
    curl \
    python3 \
    py3-pip \
    && pip3 install --break-system-packages google-cloud-storage \
    && curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts --install-dir=/opt \
    && ln -s /opt/google-cloud-sdk/bin/gsutil /usr/local/bin/gsutil \
    && ln -s /opt/google-cloud-sdk/bin/gcloud /usr/local/bin/gcloud

COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

RUN mkdir -p /backups

# Cron: daily at 2am UTC
RUN echo "0 2 * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1" > /etc/crontabs/root

CMD ["crond", "-f", "-l", "2"]
