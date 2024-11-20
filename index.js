const request = require('request');
const util = require('util');
const post_ = util.promisify(request.post);
const get_ = util.promisify(request.get);
const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const userName = 'shues';
const loadDataStep = 1000;
const shId = "1wGeWTEU7M3QOENel52zNPnKkI2UaNbMRSIgjFDXON3c";
const sourceServer = "http://94.103.91.4:5000";

const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
    try {
        const content = await fs.readFile(TOKEN_PATH);
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
    } catch (err) {
        return null;
    }
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
    let client = await loadSavedCredentialsIfExist();
    if (client) {
        return client;
    }
    client = await authenticate({
        scopes: SCOPES,
        keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
        await saveCredentials(client);
    }
    return client;
}


/**
 * Updates values in a Spreadsheet.
 * @param {string} spreadsheetId The spreadsheet ID.
 * @param {string} range The range of values to update.
 * @param {object} valueInputOption Value update options.
 * @param {(string[])[]} _values A 2d array of values to update.
 * @return {obj} spreadsheet information
 */
async function updateValues(spreadsheetId, range, valueInputOption, values, auth) {
    console.log("updateValues");
    const { google } = require('googleapis');

    const service = google.sheets({ version: 'v4', auth });
    const resource = {
        values,
    };
    try {
        const result = await service.spreadsheets.values.update({
            spreadsheetId,
            range,
            valueInputOption,
            resource,
        });
        console.log('%d cells updated.', result.data.updatedCells);
        return auth;
    } catch (err) {
        throw err;
    }
}

/**
 * Appends values in a Spreadsheet.
 * @param {string} spreadsheetId The spreadsheet ID.
 * @param {string} range The range of values to append.
 * @param {object} valueInputOption Value input options.
 * @param {(string[])[]} _values A 2d array of values to append.
 * @return {obj} spreadsheet information
 */
async function appendValues(spreadsheetId, range, valueInputOption, values, auth) {
    const { google } = require('googleapis');

    const service = google.sheets({ version: 'v4', auth });
    const resource = {
        values,
    };
    try {
        const result = await service.spreadsheets.values.append({
            spreadsheetId,
            range,
            valueInputOption,
            resource,
        });
        console.log(`${result.data.updates.updatedCells} cells appended.`);
        return result;
    } catch (err) {
        throw err;
    }
}

async function login() {
    console.log('start login');
    let url = sourceServer + '/auth/login';
    return post_({
        url,
        form: { username: userName }
    }).then(({ body }) => JSON.parse(body).token);
}

async function getClientsData(token, offset, limit) {
    let url = sourceServer + `/clients?limit=${limit}&offset=${offset}`;
    let option = {
        url,
        headers: {
            'Authorization': token
        },
    }
    return get_(option).then(({ body }) => {
        return JSON.parse(body)
    });
}

async function getUsersStatuses(token, ids) {
    let url = sourceServer + '/clients';
    // console.log(ids);
    // let bd = JSON.stringify({ userIds: [1, 2, 3] });
    // let bd = { userIds: [1, 2, 3] };
    // console.log(bd);
    return post_({
        url,
        headers: {
            "Authorization": token,
        },
        body: { userIds: ids },
        json: true
    })
        .then(({ body }) =>
            body
        );
}

async function loadUsers() {
    let usersData = [];

    const token = await login();

    let buf = [];
    let limit = loadDataStep;
    let offset = 0;
    let count = 0
    do {
        count++;
        buf = [];
        buf = await getClientsData(token, offset, limit);
        let ids = buf.map(item => item.id);
        let statuses = await getUsersStatuses(token, ids);
        let buf_ = buf.map(item => Object.assign({}, item, { status: statuses.filter(it => it.id === item.id)[0].status }))

        offset += loadDataStep;
        usersData = usersData.concat(buf_);
    } while (buf.length > 0)

    const headers = [Object.keys(usersData[0])];
    const preparedData = usersData.map(row => Object.values(row));

    authorize()
        .then((auth) => updateValues(shId, "'Лист1'!A1", "RAW", headers, auth))
        .then((auth) => appendValues(shId, "'Лист1'!A2", "RAW", preparedData, auth))
        .catch(
            console.error
        );

}

loadUsers();