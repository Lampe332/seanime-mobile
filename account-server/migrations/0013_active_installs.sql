-- 4.3.2: anonymous daily count of active app installs. Additive only.

-- One row per UTC day and install. `install` is the SHA-256 (hex) of the random ID the app makes on its first start;
-- the raw ID, the IP address, the user agent and any account data are never stored. POST /v1/ping writes it with
-- INSERT OR IGNORE, so one install counts once per day. The daily cleanup removes rows older than 400 days.
CREATE TABLE active_installs (
  day TEXT NOT NULL,
  install TEXT NOT NULL,
  version TEXT NOT NULL,
  PRIMARY KEY (day, install)
);
