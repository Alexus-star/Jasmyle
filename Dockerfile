# Railway-ready image for Jasmyle Properties.
# Railway mounts the permanent volume at /data when the container starts.
# (No VOLUME line: Railway does not allow it. No USER line: a Railway volume is owned by root,
#  and a non-root user could not write the database to it.)
FROM node:22-slim
WORKDIR /app
COPY . /app
ENV NH_DATA_DIR=/data NODE_ENV=production
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "supervisor.js"]
