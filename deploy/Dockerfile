FROM node:22-slim
WORKDIR /app
COPY . /app
RUN mkdir -p /data && chown -R node:node /data /app
USER node
ENV NH_DATA_DIR=/data NODE_ENV=production
EXPOSE 8080
VOLUME /data
CMD ["node", "--disable-warning=ExperimentalWarning", "supervisor.js"]
