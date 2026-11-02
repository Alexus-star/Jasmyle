#!/usr/bin/env bash
# Copies backups + the encryption key to a cloud drive with rclone (Google Drive, OneDrive, Dropbox, S3...).
#   1) install rclone, run `rclone config` once and create a remote called "jasmyle"
#   2) cron:  17 3 * * *  /opt/jasmyle/scripts/offsite-backup.sh
# The key file is uploaded too - keep that cloud folder PRIVATE (or encrypt it with an rclone "crypt" remote).
D="${NH_DATA_DIR:-/var/lib/jasmyle}"
rclone copy "$D/backups" jasmyle:jasmyle-backups --max-age 3d
rclone copyto "$D/secret.key" jasmyle:jasmyle-backups/secret.key
