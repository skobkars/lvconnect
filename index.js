/**
 * Author: Sergey Skobkarev
 * https://github.com/skobkars
 * Based on share2nightscout-bridge by Ben West:
 * https://github.com/nightscout/share2nightscout-bridge
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 *
 * @description: Allows user to store their or their patients' LibreView
 * data on their own Nightscout instance by facilitating transfer of
 * latest records from LibreView's server into NS.
 */

"use strict";

const Promise            = require("promise"),
      promiseRetry       = require("promise-retry"),
      request            = require("request"),
      qs                 = require("querystring"),
      crypto             = require("crypto"),
      meta               = require("./package.json"),
      agent              = `${meta.name}/${meta.version}`,
      min_secret_length  = 12

let   localTMZ     = ( readENV("LVCONNECT_TIME_OFFSET",0) || new Date().getTimezoneOffset() ) * 60,
      session      = {
        server     : toLvapiHost(readENV("LVCONNECT_SERVER","api.libreview.io")),
        uriPrefix  : "",
        lastDataTm : null,
        user       : {},
        patient    : {}
      };

/**
 * Checks if Lvapi: <version> header is present in responses to
 * OPTIONS request before sending over sensitive information,
 * i.e. user credentials
 */
function checkLvapi() {
  return new Promise( ( resolve, reject ) => {
    return request({
      method: "OPTIONS",
      uri: `https://${session.server}/auth/login`,
      headers: { "Accept": "*/*" },
      rejectUnauthorized: true
    }, (error, response) => {
      if( error ) return reject( error );
      if( response.headers.lvapi ) return resolve( response.headers.lvapi );
      else return reject( `${session.server} doesn't appear to be legitimate LibreView API server.` );
    });
  });
}

/**
 * Attempts to log into the LV API server
 * @param {object} params - connection parameters
 */
function login( params ) {
  return new Promise( ( resolve, reject ) => {

    if( session.tokenExpires > +new Date() ) {
      console.debug("current token is valid until", new Date( session.tokenExpires ));
      resolve( `valid until ${session.tokenExpires}` );

    } else {
      return checkLvapi()
      .then( lvapiVersion => {
        return request({
          method: "POST",
          uri: `https://${session.server}/auth/login`,
          headers: {
            "User-Agent": agent,
            "Accept": "application/json"
          },
          body: {
            "email":    params.login.accountName,
            "password": params.login.password,
            "fingerprint" : params.login.fingerprint
          },
          json: true,
          rejectUnauthorized: true

        }, (error, response, body) => {
          if( error ) return reject( error );

          if( body.data ) {

            if( body.data.redirect ) { // redirect was received
              // { country: "CA", redirect: true, region: "eu", uiLanguage: "en-US" }
              session.server = toLvapiHost(body.data.region.toUpperCase());
              console.debug( "redirected to:", session.server );
              reject( `redirected to ${session.server}` );

            } else if( body.data.user ) { // login successful
              session.authToken        = body.data.authTicket.token;
              session.tokenExpires     = +new Date() + body.data.authTicket.duration;

              if( body.data.user.id ) { // if user data present
                session.user.id          = body.data.user.id;
                session.user.accountType = body.data.user.accountType;

                console.debug( "loging successful:", session.user.id );
                resolve( "renewed" );

              } else { // otherwise get user data
                return request({
                  method: "GET",
                  uri: `https://${session.server}/user`,
                  headers: {
                    "User-Agent": agent,
                    "Accept": "application/json",
                    "Authorization": `Bearer ${session.authToken}`
                  },
                  json: true,
                  rejectUnauthorized: true

                }, (error, response, body) => {
                  if( error ) return reject( error );

                  if( body.data ) {

                    if( body.data.redirect ) { // redirect was received
                      // { country: "CA", redirect: true, region: "eu", uiLanguage: "en-US" }
                      session.server = toLvapiHost(body.data.region.toUpperCase());
                      console.debug( "redirected to:", session.server );
                      reject( `redirected to ${session.server}` );

                    } else if( body.data.user ) { // received user data
                      // allow different patient ID only for Pro accounst
                      session.user.id          = body.data.user.id;
                      session.user.accountType = body.data.user.accountType;
                      session.authToken        = body.data.authTicket.token;
                      session.tokenExpires     = +new Date() + body.data.authTicket.duration;

                      console.debug( "loging successful:", session.user.id );
                      resolve( "renewed" );
                    }

                  } else if( body.error ) { // login filed
                    reject( `login: Check credentals. Error: ${body.error.message}` );

                  } else { // no sensible data has been returned
                    reject( "login: Unknown response, check connection parameters." );

                  }
                });
              }
            }

          } else if( body.error ) { // login filed
            reject( `login: Check credentals. Error: ${body.error.message}` );

          } else { // no sensible data has been returned
            reject( "login: Unknown response, check connection parameters." );

          }
        });
      })
      .catch( error => { reject( error ); });
    }
  });
}

/**
 * Obtains patient details if the user is a practice with a Pro account
 * @param {object} params - connection parameters
 */
function getPatientData( params ) {
  return new Promise( ( resolve, reject ) => {
    return request({
      method: "GET",
      uri: `https://${session.server}/patients/${params.login.patientId}`,
      headers: {
        "User-Agent": agent,
        "Accept": "application/json",
        "Authorization": `Bearer ${session.authToken}`
      },
      json: true,
      rejectUnauthorized: true

    }, (error, response, body) => {
      if( error ) return reject( error );

      if( body.ticket ) { // received new authTicket
        session.authToken    = body.ticket.token;
        session.tokenExpires = +new Date() + body.ticket.duration;
      }

      if( body.data ) {

        if( body.data.patient ) { // received user data
          session.patient.id = body.data.patient.id;
          console.debug( "received patient details:", session.patient.id );
        }
        session.uriPrefix = `/patients/${params.login.patientId}`;
        resolve( "renewed" );

      } else if( body.error ) { // login filed
        reject( `Failed getting patient details: ${body.error.message}` );

      } else { // no sensible data has been returned
        reject( "getPatientData: Unknown response, check connection parameters." );

      }
    });
  });
}

/**
 * Attempts to authorize on an LV API server a number of times before giving up.
 * Also allows to use redirects sent by server in body.
 * @param {object} params - connection parameters
 */
function authorize( params ) {
  return login( params )
  .then( status => {
    if( status === "renewed" ) {
      if( session.user.id == params.login.patientId || session.user.accountType == "pat" ) {
        console.info( "patient is the user" );
        session.patient = session.user;
        return status;

      } else if ( params.login.patientId ) {
        console.info( "patient is not the user" );
        return getPatientData( params );

      } else {
        return new Promise( ( resolve, reject ) => {
          reject( "no patient ID specified for Pro account type" );
        });
      }
    } else {
      return status;
    }
  });
}

function getDataSources() {
  return new Promise( ( resolve, reject ) => {
    return request({
      method: "GET",
      uri: `https://${session.server}${session.uriPrefix}/reportSettings`,
      headers: {
        "User-Agent": agent,
        "Accept": "application/json",
        "Authorization": `Bearer ${session.authToken}`
      },
      json: true,
      rejectUnauthorized: true

    }, (error, response, body) => {
      if( error ) return reject( error );

      if( body.ticket ) { // received new authTicket
        session.authToken    = body.ticket.token;
        session.tokenExpires = +new Date() + body.ticket.duration;
      }

      if( body.data ) {
        if( body.data.dataSources )
          session.patient.dataSources = body.data.dataSources;
        resolve( "dataSources" );

      } else if( body.error ) { // login filed
        reject( `Failed getting reportSettings (for data sources): ${body.error.message}` );

      } else if( body.message ) { // login filed
        reject( `getDataSources: Cannot get data sources, received message: '${body.message}'` );

      } else { // no sensible data has been returned
        reject( "getDataSources: Unknown response, check connection parameters." );

      }
    });
  });
}

function generateReports() {
  return new Promise( ( resolve, reject ) => {
    session.patient.primDevice = null;
    session.patient.secDevices = [];
    for( let id in session.patient.dataSources ) {
      if( !session.patient.primDevice && session.patient.dataSources[id].daysData.includes(1) ) {
        session.patient.primDevice = {
          id              : id,
          typeId          : session.patient.dataSources[id].type,
          firmwareVersion : session.patient.dataSources[id].firmwareVersion
        };
      } else {
        session.patient.secDevices.push(id);
      }
    }
    if( session.patient.primDevice ) {
      return request({
        method: "POST",
        uri: `https://${session.server}/reports`,
        headers: {
          "User-Agent": agent,
          "Accept": "application/json",
          "Authorization": `Bearer ${session.authToken}`
        },
        body: {
          PrimaryDeviceId                     : session.patient.primDevice.id,
          PrimaryDeviceTypeId                 : session.patient.primDevice.typeId,
          SecondaryDeviceIds                  : session.patient.secDevices,
          PrintReportsWithPatientInformation  : false,
          ReportIds                           : [ 500000 + session.patient.primDevice.typeId ],
          ClientReportIDs                     : [ 5 ],
          StartDates                          : [ session.lastDataTm - localTMZ ],
          EndDate                             : Math.floor(+new Date() / 1000),
          PatientId                           : session.patient.id,
          CultureCode                         : "en-US",
          // Country: "CA",
          // CultureCodeCommunication: "en-US",
          // DateFormat: 2,
          // GlucoseUnits: 0,
        },
        json: true,
        rejectUnauthorized: true

      }, (error, response, body) => {
        if( error ) return reject( error );

        if( body.ticket ) { // received new authTicket
          session.authToken    = body.ticket.token;
          session.tokenExpires = +new Date() + body.ticket.duration;
        }

        if( body.data ) {
          if( body.data.url )
            resolve( body.data.url );
          else
            reject( "generateReports: No URL for channels returned.");

        } else if( body.error ) { // login filed
          reject( `generateReports: Failed request for reports: ${body.error.message}` );

        } else { // no sensible data has been returned
          reject( "generateReports: Unknown response, check connection parameters." );
        }
      });

    } else {
      reject( 'generateReports: no recent data for patient' );
    }
  });
}

function getChannels( url ) {
  return new Promise( ( resolve, reject ) => {
    return request({
      method: "GET",
      uri: url,
      headers: {
        "User-Agent": agent,
        "Accept": "application/json",
        "Authorization": `Bearer ${session.authToken}`
      },
      json: true,
      rejectUnauthorized: true

    }, (error, response, body) => {
      if( error ) return reject( error );

      if( body.data ) {
        if( body.data.lp )
          resolve( body.data.lp );
        else
          reject( "getChannels: No http channel available." );

      } else { // no sensible data has been returned
        reject( "getChannels: Unknown response, check connection parameters." );

      }
    });
  });
}

function getReportUrl( url ) {
  return new Promise( ( resolve, reject ) => {
    return request({
      method: "GET",
      uri: url,
      headers: {
        "User-Agent": agent,
        "Accept": "application/json"
      },
      json: true,
      rejectUnauthorized: true

    }, (error, response, body) => {
      if( error ) return reject( error );

      if( body.args ) {
        if( body.args.urls && body.args.urls[5] )
          resolve( body.args.urls[5] );

        else
          reject( "getReportUrl: No report URL provided." );

      } else {// no sensible data has been returned
        reject( "getReportUrl: Unknown response, check connection parameters." );

      }
    });
  });
}

function downloadReport( url ) {
  return new Promise( ( resolve, reject ) => {
    return request({
      method: "GET",
      uri: `${url}?session=${session.authToken}`,
      headers: {
        "User-Agent": agent,
        "Accept": "text/html"
      },
      rejectUnauthorized: true

    }, (error, response, body) => {
      if( error ) return reject( error );

      if( body ) {
        const found = body.match(/DataForLibreDailyLog\s*=\s*({.*})/);
        if( found && found.length>1 ) {
          try { resolve( JSON.parse(found[1]).Data ); }
          catch( err ) { reject( err ); }

        } else {
          reject( 'downloadReport: No data received.' );
        }

      } else { // no sensible data has been returned
        console.debug(response);
        reject( "downloadReport: Unknown response, check connection parameters." );

      }
    });
  });
}

/**
 * Fetch data from LV API server through DailLog report.
 */
function fetch() {
  return getDataSources()
  .then( ()  => { return generateReports();     } )
  .then( url => { return getChannels( url );    } )
  .then( url => { return getReportUrl( url );   } )
  .then( url => { return downloadReport( url ); } )
}

/**
 * Convert data for
 * @param {object} glucose - single glucose data received from LibreView
 */
function convertOneGlucose (glucose) {
  /* glucose:
      {
        Timestamp: 1632846647,
        Value: 14.8,
        IsTimeChange: false
      }
  */
  glucose.Timestamp = glucose.Timestamp + localTMZ;
  // Find last data fetched for recurring queries
  if( glucose.Timestamp > session.lastDataTm )
    session.lastDataTm = glucose.Timestamp;

  return {
    sgv: Math.round(glucose.Value * 18.018),
    date: glucose.Timestamp * 1000,
    dateString: (new Date(glucose.Timestamp * 1000)).toISOString(),
    device: `${agent}/${session.patient.primDevice.typeId}`+
            `/${session.patient.primDevice.firmwareVersion}`,
    type: "sgv"
  };
}

/**
 * Process all fetched LiveView data into a flat array of Nightscout data
 * @param {object} lvData - fetched DailyLog data
 */
function convertAll( lvData ) {
  return flatDeep(lvData.Days.map( day => {
    // .concat(day.SensorScans.flat().map( convertOneGlucose ));
    return flatDeep(day.Glucose, Infinity).map( convertOneGlucose );
  }), Infinity);
}

/**
 * Send fetched LiveView data to Nightscout
 * @param {object} params - connection parameters for the Nightscout
 * @param {object} entries - data converted to Nightscout format
 */
function uploadToNightscout( params, entries ) {
  return new Promise( ( resolve, reject ) => {
    if( entries.length == 0 )
      return resolve( { uploadToNightscout: "zero entries fetched, nothing to upload" } );

    if (params && params.callback && params.callback.call) {
      params.callback(null, entries);

    } else if( params.nightscout.endpoint ) {
      console.debug(`uploading to Nightscout: ${params.nightscout.endpoint}`);
      return request({
        method: "POST",
        uri: `${params.nightscout.endpoint}/api/v1/entries.json`,
        headers: {
          "User-Agent": agent,
          "Accept": "application/json",
          "api-secret": crypto.createHash("sha1").update(params.nightscout.API_SECRET).digest("hex")
        },
        body: entries,
        json: true,
        rejectUnauthorized: true

      }, (error, response, body) => {
        if( error ) return reject( error );
        else        return resolve( body );
      });

    } else {
      return reject( { uploadToNightscout: "neither callback function, nor endpoint specified." } );
    }
  });
}

/**
 * Reads environment variable if present, or returns its
 * default value
 * @param {string} varName - variable name
 * @param {varies} defaultValue - default value
 */
function readENV( varName, defaultValue ) {
  // for some reason Azure uses this prefix, maybe there is a good reason
  return process.env["CUSTOMCONNSTR_" + varName]
      || process.env["CUSTOMCONNSTR_" + varName.toLowerCase()]
      || process.env[varName]
      || process.env[varName.toLowerCase()]
      || defaultValue;
}

/**
 * Converts lvserver / "LV_SERVER" variable to a hostname
 * @param {string} lvserver - a custom hostname, or "US", or "EU"
 */
function toLvapiHost( lvserver ) {
  return (
    lvserver.toUpperCase() === "EU" ? "api-eu.libreview.io" : (
    lvserver.toUpperCase() === "US" ? "api-us.libreview.io" : (
    lvserver.indexOf(".") > 1       ? lvserver :
    "api.libreview.io" ))
  );
}

/**
 * Flattens arrays in Node.js before vesrion 11
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/flat
 * @param {array} arr - array to flatten
 * @param {number}  d - recursion depth
 */
function flatDeep(arr, d = 1) {
   return d > 0 ? arr.reduce((acc, val) => acc.concat(Array.isArray(val) ? flatDeep(val, d - 1) : val), [])
                : arr.slice();
};

// function nullify_battery_status (params, then) {
//   let shasum = crypto.createHash("sha1");
//   let hash = shasum.update(params.nightscout.API_SECRET);
//   let headers = { "api-secret": shasum.digest("hex")
//                 , "Accept": "application/json" };
//   let url = `${params.nightscout.endpoint}/api/v1/devicestatus.json`;
//   let body = { uploaderBattery: false };
//   let req = { uri: url, body: body, json: true, headers: headers, method: "POST"
//             , rejectUnauthorized: false };
//   return request(req, then);
// }


/**
 * Provide public, testable API
 */
function engine( params ) {

  // Reset localTMZ in case a time change happened
  localTMZ = ( params.timeOffset || new Date().getTimezoneOffset() ) * 60
  console.info( `localTMZ: ${localTMZ}` );

  if( !session.lastDataTm ) // set start fetch time in case this is a first run
    session.lastDataTm =  new Date().setHours(0,0,0,0) / 1000 -
      localTMZ - params.firstFullDays * 86400;

  function my() {
    return promiseRetry(
      { minTimeout: 3000, retries: params.maxFailures - 1, factor: 1.5 },
      ( retry, n ) => {
        console.debug(
          `lvconnect: attempt to login, fetch and upload data # ${n}`
        );
        return authorize( params )
        .then ( () => { return fetch( params );                        } )
        .catch( retry );
      }
    )
    .then ( lv   => { return convertAll( lv );                         } )
    .then ( ns   => { return uploadToNightscout( params, ns );         } )
    .catch( err  => { console.debug( err );                            } );
  }

  my();
  return my;
}

// engine.fetch           = fetch;
// engine.authorize       = authorize; // returns Promise
// engine.authorize_then  = ( params, then ) => {
//   authorize(params)
//   .then(
//     value => { then( value );                       },
//     error => { console.info( error ); then( false ); }
//   );
// };
module.exports         = engine;

/**
 * The below code is for developing stage, and when run from a
 * command line.
 */
if( !module.parent ) {

  if( readENV("API_SECRET").length < min_secret_length ) {
    throw new Error(
      `API_SECRET should be at least ${min_secret_length} characters long`
    );
    process.exit(1);
  }

  let params = {
    login         : {
      accountName : readENV("LVCONNECT_USER_NAME")   || readENV("LVCONNECT_PRO_USER_NAME"),
      password    : readENV("LVCONNECT_PASSWORD")    || readENV("LVCONNECT_PRO_PASSWORD"),
      fingerprint : readENV("LVCONNECT_FINGERPRINT") || readENV("LVCONNECT_PRO_FINGERPRINT"),
      patientId   : readENV("LVCONNECT_PATIENT_ID")
    },
    nightscout    : {
      API_SECRET  : readENV("API_SECRET"),
      endpoint    : readENV("NS", "https://" + readENV("WEBSITE_HOSTNAME"))
    },
    maxFailures   : readENV("LVCONNECT_MAX_FAILURES", 3),
    firstFullDays : readENV("LVCONNECT_FIRST_FULL_DAYS", 90),
    timeOffset    : readENV("LVCONNECT_TIME_OFFSET", 0)
  };

  // set initial fetch time in case this is a first run
  session.lastDataTm =  new Date().setHours(0,0,0,0) / 1000 - localTMZ -
                        params.firstFullDays * 86400;


  let args = process.argv.slice(2);
  switch( args[0] ) {

    case "login":
      promiseRetry(
        { minTimeout: 3000, retries: params.maxFailures - 1, factor: 1.5   },
        ( retry, n ) => {
          console.debug(`lvconnect: attempt to login # ${n}`);
          return authorize( params )
          .catch( retry );
        }
      )
      .then ( ()   => { saveSession();                                     } )
      .catch( err  => { console.debug( err );                              } );
      break;

    case "fetch":
      restoreSession()
      .then ( ()   => {
        return promiseRetry(
          { minTimeout: 3000, retries: params.maxFailures - 1, factor: 1.5 },
          ( retry, n ) => {
            console.debug(
              `lvconnect: attempt to login and fetch data # ${n}`
            );
            return authorize( params )
            .catch( retry );
          }
        );
      })
      .then ( ()   => { return fetch( params );                            } )
      .then ( lv   => { return saveData( lv );                             } )
      .then ( lv   => { return convertAll( lv );                           } )
      .then ( ns   => { console.dir( ns, { depth: null } );                } )
      .then ( ()   => { saveSession();                                     } )
      .catch( err  => { console.debug( err );                              } );
      break;

    case "run":
      restoreSession()
      .then ( ()   => {
        return promiseRetry(
          { minTimeout: 3000, retries: params.maxFailures - 1, factor: 1.5 },
          ( retry, n ) => {
            console.debug(
              `lvconnect: attempt to login, fetch and upload data # ${n}`
            );
            return authorize( params )
            .catch( retry );
          }
        );
      })
      .then ( ()   => { return fetch( params );                            } )
      .then ( lv   => { return saveData( lv );                             } )
      .then ( lv   => { return convertAll( lv );                           } )
      .then ( ns   => { return uploadToNightscout( params, ns );           } )
      .then ( ns   => { console.dir( ns, { depth: null } );                } )
      .then ( ()   => { saveSession();                                     } )
      .catch( err  => { console.debug( err );                              } );
      break;

    default:
      let interval = readENV("LVCONNECT_INTERVAL", 30000);
      let timer = null;
      (function run() {
        console.info( "Fetching LibreView Data..." );
        engine( params );
        timer = setTimeout(run, interval);
      })();
      break;
  }
}

/**
 * The below code is for developing stage.
 * Saves session parameters to local file.
 */
function saveSession() {
  console.debug("saving session...");
  require("fs").writeFile( "session.json",
    JSON.stringify( session ),
    "utf8",
    err => { if (err) console.debug( err ); }
  );
}

/**
 * The below code is for developing stage.
 * Restores session parameters from local file.
 */
function restoreSession() {
  return new Promise( ( resolve, reject ) => {
    return require("fs").readFile( "session.json", "utf8", (error, data) => {
      if( data ) {
        try {
          console.debug("reading stored session...");
          session = JSON.parse(data);
        } catch( e ) { console.debug(e); }
      }
      resolve();
    });
  });
}

/**
 * The below code is for developing stage.
 * Saves fetched data to local file.
 */
function saveData(data) {
  console.debug("saving data...");
  require("fs").writeFile( "fetched.json",
    JSON.stringify( data ),
    "utf8",
    err => { if (err) console.debug( err ); }
  );
  return data;
}
