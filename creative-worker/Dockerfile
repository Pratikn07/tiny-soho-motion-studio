FROM node:24-bookworm-slim
# Official Modal billing summary API is currently available in the Python SDK.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/modal-billing \
    && /opt/modal-billing/bin/pip install --no-cache-dir modal==1.6.0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
CMD ["npm", "run", "start"]
