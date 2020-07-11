/* eslint-disable import/no-cycle */
import path from 'path';
import fs from 'fs';
import semver from 'semver';
import inquirer from 'inquirer';
import net from 'net';

import { execCLI } from '../../systemTools/exec';
import {
    RENATIVE_CONFIG_NAME,
    CLI_TIZEN_EMULATOR,
    CLI_TIZEN,
    CLI_SDB_TIZEN
} from '../../constants';
import {
    getAppFolder,
    getAppVersion,
    getAppTemplateFolder,
    getConfigProp,
    waitForEmulator,
    waitForWebpack,
    checkPortInUse,
    confirmActiveBundler
} from '../../common';
import {
    chalk,
    logTask,
    logError,
    logWarning,
    logDebug,
    logSuccess,
    logToSummary
} from '../../systemTools/logger';
import { isPlatformActive } from '..';
import {
    copyAssetsFolder,
    copyBuildsFolder
} from '../../projectTools/projectParser';
import { buildWeb, configureCoreWebProject } from '../web';
import { rnvStart } from '../runner';
import Config from '../../config';
import { writeCleanFile } from '../../systemTools/fileutils';

const xml2js = require('xml2js');

const parser = new xml2js.Parser();


const formatXMLObject = (obj) => {
    const platArr = obj['model-config']?.platform;
    const platKeyArr = platArr?.[0]?.key || platArr?.key;
    if (platKeyArr) {
        return {
            ...platKeyArr.reduce((acc, cur) => {
                acc[cur.name] = cur.$t;
                return acc;
            }, {})
        };
    }
    logWarning('Invalid object received from shell cat /etc/config/model-config.xml');
    return {};
};

const DEFAULT_SECURITY_PROFILE_NAME = 'RNVanillaCert';
const DEFAULT_CERTIFICATE_NAME = 'tizen_author';
const DEFAULT_CERTIFICATE_NAME_WITH_EXTENSION = `${DEFAULT_CERTIFICATE_NAME}.p12`;

export const configureTizenGlobal = c => new Promise((resolve, reject) => {
    logTask('configureTizenGlobal');
    // Check Tizen Cert
    // if (isPlatformActive(c, TIZEN) || isPlatformActive(c, TIZEN_WATCH)) {
    const tizenAuthorCert = path.join(c.paths.workspace.dir, DEFAULT_CERTIFICATE_NAME_WITH_EXTENSION);
    if (fs.existsSync(tizenAuthorCert)) {
        logDebug(`${DEFAULT_CERTIFICATE_NAME_WITH_EXTENSION} file exists!`);
        resolve();
    } else {
        logWarning(
            `${DEFAULT_CERTIFICATE_NAME_WITH_EXTENSION} file missing! Creating one for you...`
        );
        createDevelopTizenCertificate(c)
            .then(() => resolve())
            .catch(e => reject(e));
    }
    // }
});

export const launchTizenSimulator = (c, name) => {
    logTask(`launchTizenSimulator:${name}`);

    if (name) {
        return execCLI(c, CLI_TIZEN_EMULATOR, `launch --name ${name}`, {
            detached: true
        });
    }
    return Promise.reject('No simulator -t target name specified!');
};

export const listTizenTargets = async (c) => {
    const targets = await execCLI(c, CLI_TIZEN_EMULATOR, 'list-vm', {
        detached: true
    });
    const targetArr = targets.split('\n');
    let targetStr = '';
    Object.keys(targetArr).forEach((i) => {
        targetStr += `[${i}]> ${targetArr[i]}\n`;
    });
    logToSummary(`Tizen Targets:\n${targetStr}`);
};

export const createDevelopTizenCertificate = c => new Promise((resolve) => {
    logTask('createDevelopTizenCertificate');

    const certDirPath = c.paths.workspace.dir;
    const certFilename = DEFAULT_CERTIFICATE_NAME;
    const certPassword = '1234';

    execCLI(
        c,
        CLI_TIZEN,
        `certificate -- ${certDirPath} -a rnv -f ${certFilename} -p ${certPassword}`,
        { privateParams: [certPassword] },
    )
        .then(() => addDevelopTizenCertificate(c, {
            profileName: DEFAULT_SECURITY_PROFILE_NAME,
            certPath: path.join(certDirPath, `${certFilename}.p12`),
            certPassword,
        }))
        .then(() => resolve())
        .catch((e) => {
            logError(e);
            resolve();
        });
});

export const addDevelopTizenCertificate = (c, secureProfileConfig) => new Promise((resolve) => {
    logTask('addDevelopTizenCertificate');

    const { profileName, certPath, certPassword } = secureProfileConfig || {};
    execCLI(
        c,
        CLI_TIZEN,
        `security-profiles add -n ${profileName} -a ${certPath} -p ${certPassword}`,
        { privateParams: [certPassword] },
    )
        .then(() => resolve())
        .catch((e) => {
            logError(e);
            resolve();
        });
});

const _getDeviceID = async (c, target) => {
    const { device } = c.program;

    if (device) {
        let connectResponse;
        try {
            connectResponse = await execCLI(
                c,
                CLI_SDB_TIZEN,
                `connect ${target}`
            );
        } catch (e) {
            connectResponse = e;
        }
        if (connectResponse.includes('EPERM')) {
            throw new Error(
                "We can't connect to this device even though it is reachable. Please make sure you have enabled Developer Mode and you have added your IP in the Host PC IP section. For more information consult https://developer.samsung.com/tv/develop/getting-started/using-sdk/tv-device"
            );
        }
        if (connectResponse.includes('failed to connect to remote target')) {
            throw new Error(
                `Failed to connect to ${target}. Make sure the IP is correct and you are connected on the same network.`
            );
        }
        if (connectResponse.includes('error')) throw new Error(connectResponse);
    }

    const devicesList = await execCLI(c, CLI_SDB_TIZEN, 'devices');
    if (devicesList.includes(target)) {
        const lines = devicesList.trim().split(/\r?\n/);
        const devices = lines.filter(line => line.includes(target));

        if (devices.length > 1) {
            // @todo handle more than one
        }

        const deviceID = devices[0].split('device')[1].trim();
        return deviceID;
    }
    return Promise.reject(`No device matching ${target} could be found.`);
};

const _getRunningDevices = async (c) => {
    const { platform } = c.program;
    const devicesList = await execCLI(c, CLI_SDB_TIZEN, 'devices');
    const lines = devicesList
        .trim()
        .split(/\r?\n/)
        .filter(line => !line.includes('List of devices'));
    const devices = [];

    await Promise.all(
        lines.map(async (line) => {
            const words = line.replace(/\t/g, '').split('    ');
            if (words.length >= 3) {
                const name = words[0].trim();
                const deviceInfoXML = await execCLI(
                    c,
                    CLI_SDB_TIZEN,
                    `-s ${name} shell cat /etc/config/model-config.xml`,
                    { ignoreErrors: true }
                );

                let deviceInfo;
                let deviceType;

                if (deviceInfoXML !== true && deviceInfoXML !== '') {
                    // for some reason the tv does not connect through sdb

                    const parseObj = await parser.parseStringPromise(deviceInfoXML);

                    deviceInfo = formatXMLObject(parseObj);
                    deviceType = deviceInfo['tizen.org/feature/profile'];
                }

                if (
                    (platform === 'tizenmobile' && deviceType === 'mobile')
                    || (platform === 'tizenwatch' && deviceType === 'wearable')
                    || (platform === 'tizen' && !deviceType)
                ) {
                    devices.push({
                        name,
                        type: words[1].trim(),
                        id: words[2].trim(),
                        deviceType
                    });
                }
            }
        })
    );

    return devices;
};

const _waitForEmulatorToBeReady = (c, target) => waitForEmulator(c, CLI_SDB_TIZEN, 'devices', (res) => {
    const lines = res.trim().split(/\r?\n/);
    const devices = lines.filter(
        line => line.includes(target) && line.includes('device')
    );
    return devices.length > 0;
});

const _composeDevicesString = devices => devices.map(device => ({
    key: device.id,
    name: device.name,
    value: device.id
}));

const startHostedServerIfRequired = (c) => {
    if (Config.isWebHostEnabled) {
        return rnvStart(c);
    }
};

export const runTizen = async (c, platform, target) => {
    logTask(`runTizen:${platform}:${target}`);

    const platformConfig = c.buildConfig.platforms[platform];
    const { hosted } = c.program;

    const isHosted = hosted ?? !getConfigProp(c, platform, 'bundleAssets');
    // if (debug) isHosted = false;

    if (!platformConfig) {
        throw new Error(
            `runTizen: ${chalk().grey(
                platform
            )} not defined in your ${chalk().white(c.paths.appConfig.config)}`
        );
    }
    if (!platformConfig.appName) {
        throw new Error(
            `runTizen: ${chalk().grey(
                platform
            )}.appName not defined in your ${chalk().white(
                c.paths.appConfig.config
            )}`
        );
    }

    const tDir = getAppFolder(c, platform);
    const tBuild = path.join(tDir, 'build');
    const tOut = path.join(tDir, 'output');
    const tId = platformConfig.id;
    const wgt = `${platformConfig.appName}.wgt`;
    const certProfile = platformConfig.certificateProfile ?? DEFAULT_SECURITY_PROFILE_NAME;

    let deviceID;

    if (isHosted) {
        const isPortActive = await checkPortInUse(c, platform, c.runtime.port);
        if (isPortActive) {
            await confirmActiveBundler(c);
            c.runtime.skipActiveServerCheck = true;
        }
    }

    const askForEmulator = async () => {
        const { startEmulator } = await inquirer.prompt([
            {
                name: 'startEmulator',
                type: 'confirm',
                message: `Could not find or connect to the specified target (${
                    target
                }). Would you like to start an emulator?`
            }
        ]);

        if (startEmulator) {
            const defaultTarget = c.files.workspace.config.defaultTargets[platform];
            try {
                await launchTizenSimulator(c, defaultTarget);
                deviceID = defaultTarget;
                await _waitForEmulatorToBeReady(c, defaultTarget);
                return continueLaunching();
            } catch (e) {
                logDebug(`askForEmulator:ERRROR: ${e}`);
                try {
                    await execCLI(
                        c,
                        CLI_TIZEN_EMULATOR,
                        `create -n ${defaultTarget} -p tv-samsung-5.0-x86`
                    );
                    await launchTizenSimulator(c, defaultTarget);
                    deviceID = defaultTarget;
                    await _waitForEmulatorToBeReady(c, defaultTarget);
                    return continueLaunching();
                } catch (err) {
                    logDebug(err);
                    logError(
                        `Could not find the specified target and could not create the emulator automatically.
Please create one and then edit the default target from ${c.paths.workspace.dir}/${RENATIVE_CONFIG_NAME}`
                    );
                }
            }
        }
    };

    const continueLaunching = async () => {
        let hasDevice = false;

        !isHosted && (await buildWeb(c, platform));
        await execCLI(c, CLI_TIZEN, `build-web -- ${tDir} -out ${tBuild}`);
        await execCLI(
            c,
            CLI_TIZEN,
            `package -- ${tBuild} -s ${certProfile} -t wgt -o ${tOut}`
        );

        try {
            const packageID = platform === 'tizenwatch' || platform === 'tizenmobile'
                ? tId.split('.')[0]
                : tId;
            await execCLI(
                c,
                CLI_TIZEN,
                `uninstall -p ${packageID} -t ${deviceID}`,
                { ignoreErrors: true }
            );
            hasDevice = true;
        } catch (e) {
            if (e && e.includes && e.includes('No device matching')) {
                await launchTizenSimulator(c, target);
                hasDevice = await _waitForEmulatorToBeReady(c, target);
            }
        }
        try {
            await execCLI(
                c,
                CLI_TIZEN,
                `install -- ${tOut} -n ${wgt} -t ${deviceID}`
            );
            hasDevice = true;
        } catch (err) {
            logError(err);
            logWarning(
                `Looks like there is no emulator or device connected! Let's try to launch it. "${chalk().white.bold(
                    `rnv target launch -p ${platform} -t ${target}`
                )}"`
            );

            await launchTizenSimulator(c, target);
            hasDevice = await _waitForEmulatorToBeReady(c, target);
        }

        let toReturn = true;

        if (isHosted) {
            toReturn = startHostedServerIfRequired(c);
            await waitForWebpack(c);
        }

        if (
            platform !== 'tizenwatch'
            && platform !== 'tizenmobile'
            && hasDevice
        ) {
            await execCLI(c, CLI_TIZEN, `run -p ${tId} -t ${deviceID}`);
        } else if (
            (platform === 'tizenwatch' || platform === 'tizenmobile')
            && hasDevice
        ) {
            const packageID = tId.split('.');
            await execCLI(
                c,
                CLI_TIZEN,
                `run -p ${packageID[0]} -t ${deviceID}`
            );
        }
        return toReturn;
    };

    // Check if target is present or it's the default one
    const isTargetSpecified = c.program.target;

    // Check for running devices
    const devices = await _getRunningDevices(c);

    if (isTargetSpecified) {
        // The user requested a specific target, searching for it in active ones
        if (net.isIP(target)) {
            deviceID = await _getDeviceID(c, target);
            return continueLaunching();
        }

        if (devices.length > 0) {
            const targetDevice = devices.find(
                device => device.id === target || device.name === target
            );
            if (targetDevice) {
                deviceID = targetDevice.id;
                return continueLaunching();
            }
        }
        try {
            // try to launch it, see if it's a simulator that's not started yet
            await launchTizenSimulator(c, target);
            await _waitForEmulatorToBeReady(c, target);
            deviceID = target;
            return continueLaunching();
        } catch (e) {
            return askForEmulator();
        }
    } else {
        if (devices.length === 1) {
            deviceID = devices[0].id;
            return continueLaunching();
        }
        if (devices.length > 1) {
            const choices = _composeDevicesString(devices);
            const { chosenEmulator } = await inquirer.prompt([
                {
                    name: 'chosenEmulator',
                    type: 'list',
                    message: 'On what emulator would you like to run the app?',
                    choices
                }
            ]);
            deviceID = chosenEmulator;
            return continueLaunching();
        }
        return askForEmulator();
    }
};

export const buildTizenProject = async (c, platform) => {
    logTask(`buildTizenProject:${platform}`);

    const platformConfig = c.buildConfig.platforms[platform];
    const tDir = getAppFolder(c, platform);

    await buildWeb(c, platform);
    if (!c.program.hosted) {
        const tOut = path.join(tDir, 'output');
        const tBuild = path.join(tDir, 'build');
        const certProfile = platformConfig.certificateProfile ?? DEFAULT_SECURITY_PROFILE_NAME;

        await execCLI(c, CLI_TIZEN, `build-web -- ${tDir} -out ${tBuild}`);
        await execCLI(
            c,
            CLI_TIZEN,
            `package -- ${tBuild} -s ${certProfile} -t wgt -o ${tOut}`
        );

        logSuccess(
            `Your WGT package is located in ${chalk().white(tOut)} .`
        );
    }

    return true;
};

let _isGlobalConfigured = false;

export const configureTizenProject = async (c, platform) => {
    logTask('configureTizenProject');

    c.runtime.platformBuildsProjectPath = `${getAppFolder(c, c.platform)}`;

    if (!isPlatformActive(c, platform)) return;

    if (!_isGlobalConfigured) {
        _isGlobalConfigured = true;
        await configureTizenGlobal(c);
    }

    await copyAssetsFolder(c, platform);
    await configureCoreWebProject(c, platform);
    await configureProject(c, platform);
    return copyBuildsFolder(c, platform);
};

export const configureProject = (c, platform) => new Promise((resolve) => {
    logTask(`configureProject:${platform}`);

    const appFolder = getAppFolder(c, platform);

    const configFile = 'config.xml';
    const p = c.buildConfig.platforms[platform];
    writeCleanFile(
        path.join(getAppTemplateFolder(c, platform), configFile),
        path.join(appFolder, configFile),
        [
            { pattern: '{{PACKAGE}}', override: p.package },
            { pattern: '{{ID}}', override: p.id },
            { pattern: '{{APP_NAME}}', override: p.appName },
            { pattern: '{{APP_VERSION}}', override: semver.coerce(getAppVersion(c, platform)) }
        ], null, c
    );

    resolve();
});
