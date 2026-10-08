FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
# Optional trusted enterprise/cloud CA bundle; verification stays enabled and
# the bundle is not copied into image layers. Omit on ordinary NAS builds.
RUN --mount=type=secret,id=ca_bundle \
    if [ -f /run/secrets/ca_bundle ]; then export PIP_CERT=/run/secrets/ca_bundle; fi; \
    pip install --no-cache-dir --require-hashes -r requirements.txt
COPY --chown=10001:10001 naver_mail ./naver_mail
USER 10001:10001
EXPOSE 3001
CMD ["python", "-m", "naver_mail.server"]
