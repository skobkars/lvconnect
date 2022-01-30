lvconnect
=========

[![Deploy to Heroku](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/skobkars/lvconnect)

lvconnect copies your CGM data from LibreView web services to a [Nightscout](https://github.com/nightscout/cgm-remote-monitor) website. The tool runs as `node.js index.js`, or as a Nightscout plugin, and will atempt to connect to your LibreView account, fetch data and upload to your Nightscout website via its REST API.

### Prerequisites

* A working LibreView account, either Personal or Pro. NOTE: In case of a Pro account any connected patient data can be fetched, so please make sure that the correct Nightscout URL and API_SECRET are set, or otherwise data will be uploaded and merge to the wrong Nightscout.
* A working Nightscout website

### Environment

`VARIABLE` (default) - description

#### Required

* `API_SECRET` - A secret passphrase that must be at least 12 characters long, and must match the `API_SECRET` from your Nightscout website
* `WEBSITE_HOSTNAME` - The hostname for your Nightscout website.  Example: sitename.herokuapp.com or sitename.azurewebsites.net. Do not include http:// or https://
* `LVCONNECT_SERVER` (api.libreview.io)- LibreView api website. ['EU', 'US', or any actual hostname]. Blank value can be used to get redirect LibreView servers in the US. Set to (EU) to fetch from servers outside of US from the beginning.
* `LVCONNECT_USER_NAME` - Your personal account email for the Pro LibreView service. Overrides LVCONNECT_PRO_USER_NAME if set. Can be left empty if Pro account is used (see below).
* `LVCONNECT_PASSWORD` - Your personal password for the Pro LibreView service. Overrides LVCONNECT_PRO_PASSWORD if set. Can be left empty if Pro account is used (see below).
* `LVCONNECT_FINGERPRINT` - Your LibreView account's fingerprint for skipping 2FA code verification step.

#### Optional

* `LVCONNECT_PRO_USER_NAME` - Account email for the Pro LibreView service.
* `LVCONNECT_PRO_PASSWORD` - Password for the Pro LibreView service.
* `LVCONNECT_PRO_FINGERPRINT` - Your Pro LibreView account's fingerprint for skipping 2FA code verification step.
* `LVCONNECT_PATIENT_ID` - LibreView Pro connected patient UUID. Used with Pro accounts to access one of the connected patients data. Ignored for personal LibreView accounts.
* `LVCONNECT_INTERVAL` (3600000) - The time (in milliseconds) to wait between each update. Default is 1 hour
* `LVCONNECT_MAX_FAILURES` (3) -The maximum number of attempts to connect to the LibreView server.
* `LVCONNECT_FIRST_FULL_DAYS` (90) - The number of days to search for data on the first update only.
* `NS` - A fully-qualified Nightscout URL (e.g. `https://sitename.herokuapp.com`) which overrides `WEBSITE_HOSTNAME`

### More information

Before sending over and sensitive user information lvconnect checks if the `LVCONNECT_SERVER` appears to be a valid Lvapi server, then logs in and fetches historical glucose data through the Daily Log report. This information is then uploaded to the user's specified `WEBSITE_HOSTNAME` or `NS`.

If called without any parameters as a stand-alone tool, or as a plugin lvconnect will fetch data accumulated since previous call every `LVCONNECT_INTERVAL` ms, except for the the first run when it will request all data in the last `LVCONNECT_FIRST_FULL_DAYS`. Only essential step information is printed out.

The following three command line parameters are used for development and debugging:
* `login` - forces starting of a new login session and fetches new authentication token.
* `fetch` - prevents fetched data from being uploaded to Nightscout, and saves it to `fetched.json` instead.
* `run` - runs one full authorize/fetch/upload cycle.

In development mode lvconnect only fetches data once per call, and its current session is saved to a `session.json` file and is resused for next calls. It also re-uses authentication tokens until they expire, or obtaines new ones as required.

Deletion of the `session.json` file will enforce new session start.

### Disclaimer

The code is lisensed under [GNU General Public License](https://www.gnu.org/licenses/#GPL).

This project is not approved by any national Health Authority, not recommended for therapy, and not
related to, or approved by [LibreView / Abbott](https://www.libreview.com/regulatoryInformation).
