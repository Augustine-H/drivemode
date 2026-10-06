FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY nas/requirements.lock /app/requirements.lock
RUN pip install --no-cache-dir -r requirements.lock
COPY api_common.py recognition_languages.py transcription_providers.py generation_providers.py job_store.py provider.py nas_store.py nas_api.py /app/
RUN useradd --uid 10001 --no-create-home music
USER 10001:10001
EXPOSE 8094
CMD ["python", "nas_api.py", "--host", "0.0.0.0", "--port", "8094"]
