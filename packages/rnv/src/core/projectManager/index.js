import path from 'path';
import { INJECTABLE_CONFIG_PROPS, RN_BABEL_CONFIG_NAME } from '../constants';
import {
    getAppFolder,
    // getAppSubFolder,
    getPlatformBuildDir,
    getPlatformProjectDir,
    getBuildsFolder,
    getConfigProp,
    getTimestampPathsConfig
} from '../common';
import {
    cleanFolder,
    copyFolderContentsRecursiveSync,
    copyFileSync,
    mkdirSync,
    writeFileSync,
    fsWriteFileSync,
    fsExistsSync,
    fsReaddirSync,
    fsReadFileSync
} from '../systemManager/fileutils';
import { isPlatformActive } from '../platformManager';
import { chalk, logTask, logWarning, logDebug, logInfo, getCurrentCommand } from '../systemManager/logger';
import { copyTemplatePluginsSync } from '../pluginManager';
import { inquirerPrompt } from '../../cli/prompt';
import { getEngineRunnerByPlatform } from '../engineManager';


export const checkAndCreateGitignore = async (c) => {
    logTask('checkAndCreateGitignore');
    const ignrPath = path.join(c.paths.project.dir, '.gitignore');
    if (!fsExistsSync(ignrPath)) {
        logInfo(
            'Your .gitignore is missing. CREATING...DONE'
        );

        copyFileSync(
            path.join(c.paths.rnv.dir, 'coreTemplateFiles/gitignore-template'),
            ignrPath
        );
    }
    return true;
};

export const checkAndCreateBabelConfig = async (c) => {
    logTask('checkAndCreateBabelConfig');

    if (!c.paths.project.configExists) return false;

    // Check babel-config
    logDebug('configureProject:check babel config');
    if (!fsExistsSync(c.paths.project.babelConfig)) {
        logInfo(
            `Your babel config file ${chalk().white(
                c.paths.project.babelConfig
            )} is missing! CREATING...DONE`
        );
        copyFileSync(
            path.join(c.paths.rnv.projectTemplate.dir, RN_BABEL_CONFIG_NAME),
            c.paths.project.babelConfig
        );
    }

    return true;
};


export const copyRuntimeAssets = c => new Promise((resolve, reject) => {
    logTask('copyRuntimeAssets');

    const destPath = path.join(c.paths.project.assets.dir, 'runtime');

    // FOLDER MERGERS FROM APP CONFIG + EXTEND
    if (c.paths.appConfig.dirs) {
        c.paths.appConfig.dirs.forEach((v) => {
            const sourcePath = path.join(v, 'assets/runtime');
            copyFolderContentsRecursiveSync(sourcePath, destPath);
        });
    } else {
        const sourcePath = path.join(
            c.paths.appConfig.dir,
            'assets/runtime'
        );
        copyFolderContentsRecursiveSync(sourcePath, destPath);
    }

    if (!c.buildConfig?.common) {
        logDebug('BUILD_CONFIG', c.buildConfig);
        reject(
            `Your ${chalk().white(
                c.paths.appConfig.config
            )} is missconfigured. (Maybe you have older version?). Missing ${chalk().white(
                '{ common: {} }'
            )} object at root`
        );

        return;
    }


    // FONTS
    let fontsObj = 'export default [';

    const duplicateFontCheck = [];
    parseFonts(c, (font, dir) => {
        if (font.includes('.ttf') || font.includes('.otf') || font.includes('.woff')) {
            const key = font.split('.')[0];
            const includedFonts = getConfigProp(
                c,
                c.platform,
                'includedFonts'
            );
            if (includedFonts) {
                if (
                    includedFonts.includes('*')
                        || includedFonts.includes(key)
                ) {
                    if (font && !duplicateFontCheck.includes(font)) {
                        duplicateFontCheck.push(font);
                        const fontSource = path.join(dir, font).replace(/\\/g, '\\\\');
                        if (fsExistsSync(fontSource)) {
                            // const fontFolder = path.join(appFolder, 'app/src/main/assets/fonts');
                            // mkdirSync(fontFolder);
                            // const fontDest = path.join(fontFolder, font);
                            // copyFileSync(fontSource, fontDest);
                            fontsObj += `{
                              fontFamily: '${key}',
                              file: require('${fontSource}'),
                          },`;
                        } else {
                            logWarning(
                                `Font ${chalk().white(
                                    fontSource
                                )} doesn't exist! Skipping.`
                            );
                        }
                    }
                }
            }
        }
    });

    fontsObj += '];';
    if (!fsExistsSync(c.paths.project.assets.runtimeDir)) {
        mkdirSync(c.paths.project.assets.runtimeDir);
    }
    const fontJsPath = path.join(
        c.paths.project.assets.dir,
        'runtime',
        'fonts.web.js'
    );
    if (fsExistsSync(fontJsPath)) {
        const existingFileContents = fsReadFileSync(fontJsPath).toString();

        if (existingFileContents !== fontsObj) {
            logDebug('newFontsJsFile');
            fsWriteFileSync(fontJsPath, fontsObj);
        }
    } else {
        logDebug('newFontsJsFile');
        fsWriteFileSync(fontJsPath, fontsObj);
    }

    const coreTemplateFiles = path.resolve(c.paths.rnv.dir, 'coreTemplateFiles');
    copyFileSync(
        path.resolve(coreTemplateFiles, 'fontManager.js'),
        path.resolve(
            c.paths.project.assets.dir,
            'runtime',
            'fontManager.js'
        )
    );
    copyFileSync(
        path.resolve(coreTemplateFiles, 'fontManager.js'),
        path.resolve(
            c.paths.project.assets.dir,
            'runtime',
            'fontManager.server.web.js'
        )
    );
    copyFileSync(
        path.resolve(coreTemplateFiles, 'fontManager.web.js'),
        path.resolve(
            c.paths.project.assets.dir,
            'runtime',
            'fontManager.web.js'
        )
    );

    resolve();
});

export const parseFonts = (c, callback) => {
    logTask('parseFonts');

    if (c.buildConfig) {
        // FONTS - PROJECT CONFIG
        if (fsExistsSync(c.paths.project.appConfigBase.fontsDir)) {
            fsReaddirSync(c.paths.project.appConfigBase.fontsDir).forEach(
                (font) => {
                    if (callback) { callback(font, c.paths.project.appConfigBase.fontsDir); }
                }
            );
        }
        // FONTS - APP CONFIG
        if (c.paths.appConfig.fontsDirs) {
            c.paths.appConfig.fontsDirs.forEach((v) => {
                if (fsExistsSync(v)) {
                    fsReaddirSync(v).forEach((font) => {
                        if (callback) callback(font, v);
                    });
                }
            });
        } else if (fsExistsSync(c.paths.appConfig.fontsDir)) {
            fsReaddirSync(c.paths.appConfig.fontsDir).forEach((font) => {
                if (callback) callback(font, c.paths.appConfig.fontsDir);
            });
        }
    }
};

export const copyAssetsFolder = async (c, platform, subPath, customFn) => {
    logTask('copyAssetsFolder');

    if (!isPlatformActive(c, platform)) return;

    // FOLDER MERGERS FROM APP CONFIG + EXTEND
    if (c.paths.appConfig.dirs) {
        const hasAssetFolder = c.paths.appConfig.dirs
            .filter(v => fsExistsSync(path.join(v, `assets/${platform}`))).length;
        if (!hasAssetFolder) {
            await generateDefaultAssets(
                c,
                platform,
                path.join(c.paths.appConfig.dirs[0], `assets/${platform}`)
            );
        }
    } else {
        const sourcePath = path.join(
            c.paths.appConfig.dir,
            `assets/${platform}`
        );
        if (!fsExistsSync(sourcePath)) {
            await generateDefaultAssets(c, platform, sourcePath);
        }
    }

    if (customFn) {
        return customFn(c, platform);
    }

    const destPath = path.join(
        getPlatformProjectDir(c, platform),
        subPath || ''
    );

    const tsPathsConfig = getTimestampPathsConfig(c, platform);

    // FOLDER MERGERS FROM APP CONFIG + EXTEND
    if (c.paths.appConfig.dirs) {
        c.paths.appConfig.dirs.forEach((v) => {
            const sourcePath = path.join(v, `assets/${platform}`);
            copyFolderContentsRecursiveSync(sourcePath, destPath, true, false, false, null, tsPathsConfig);
        });
    } else {
        const sourcePath = path.join(
            c.paths.appConfig.dir,
            `assets/${platform}`
        );
        copyFolderContentsRecursiveSync(sourcePath, destPath, true, false, false, null, tsPathsConfig);
    }
};

const generateDefaultAssets = async (c, platform, sourcePath) => {
    logTask('generateDefaultAssets');
    let confirmAssets = true;
    if (c.program.ci !== true) {
        const { confirm } = await inquirerPrompt({
            type: 'confirm',
            message: `It seems you don't have assets configured in ${chalk().white(
                sourcePath
            )} do you want generate default ones?`
        });
        confirmAssets = confirm;
    }

    if (confirmAssets) {
        const engine = getEngineRunnerByPlatform(c, c.platform);
        copyFolderContentsRecursiveSync(
            path.join(engine.originalTemplateAssetsDir, platform),
            sourcePath
        );
    }
};

export const copyBuildsFolder = (c, platform) => new Promise((resolve) => {
    logTask('copyBuildsFolder');
    if (!isPlatformActive(c, platform, resolve)) return;

    const destPath = path.join(getAppFolder(c));
    const tsPathsConfig = getTimestampPathsConfig(c, platform);

    const configPropsInjects = [];
    INJECTABLE_CONFIG_PROPS.forEach((v) => {
        configPropsInjects.push({
            pattern: `{{configProps.${v}}}`,
            override: getConfigProp(c, c.platform, v)
        });
    });
    c.configPropsInjects = configPropsInjects;
    const allInjects = [...c.configPropsInjects, ...c.systemPropsInjects, ...c.runtimePropsInjects];

    // FOLDER MERGERS PROJECT CONFIG
    const sourcePath1 = getBuildsFolder(
        c,
        platform,
        c.paths.project.appConfigBase.dir
    );
    copyFolderContentsRecursiveSync(sourcePath1, destPath, true, false, false, allInjects, tsPathsConfig);

    // FOLDER MERGERS PROJECT CONFIG (PRIVATE)
    const sourcePath1secLegacy = getBuildsFolder(
        c,
        platform,
        c.paths.workspace.project.appConfigBase.dir_LEGACY
    );
    copyFolderContentsRecursiveSync(sourcePath1secLegacy, destPath, true,
        false, false, allInjects, tsPathsConfig);

    // FOLDER MERGERS PROJECT CONFIG (PRIVATE)
    const sourcePath1sec = getBuildsFolder(
        c,
        platform,
        c.paths.workspace.project.appConfigBase.dir
    );
    copyFolderContentsRecursiveSync(sourcePath1sec, destPath, true, false, false, allInjects, tsPathsConfig);

    if (fsExistsSync(sourcePath1secLegacy)) {
        logWarning(`Path: ${chalk().red(sourcePath1secLegacy)} is DEPRECATED.
Move your files to: ${chalk().white(sourcePath1sec)} instead`);
    }

    // DEPRECATED SHARED
    if (c.runtime.currentPlatform?.isWebHosted) {
        const sourcePathShared = path.join(
            c.paths.project.appConfigBase.dir,
            'builds/_shared'
        );
        if (fsExistsSync(sourcePathShared)) {
            logWarning('Folder builds/_shared is DEPRECATED. use builds/<PLATFORM> instead ');
        }
        copyFolderContentsRecursiveSync(
            sourcePathShared,
            getPlatformBuildDir(c),
            true, false, false, allInjects
        );
    }

    // FOLDER MERGERS FROM APP CONFIG + EXTEND
    if (c.paths.appConfig.dirs) {
        c.paths.appConfig.dirs.forEach((v) => {
            const sourceV = getBuildsFolder(c, platform, v);
            copyFolderContentsRecursiveSync(
                sourceV,
                destPath,
                true, false, false, allInjects, tsPathsConfig
            );
        });
    } else {
        copyFolderContentsRecursiveSync(
            getBuildsFolder(c, platform, c.paths.appConfig.dir),
            destPath,
            true, false, false, allInjects, tsPathsConfig
        );
    }

    // FOLDER MERGERS FROM APP CONFIG (PRIVATE)
    const sourcePath0sec = getBuildsFolder(
        c,
        platform,
        c.paths.workspace.appConfig.dir
    );
    copyFolderContentsRecursiveSync(sourcePath0sec, destPath, true, false, false, allInjects, tsPathsConfig);

    copyTemplatePluginsSync(c);

    resolve();
});

const SYNCED_DEV_DEPS = [
    'rnv',
    '@rnv/engine-rn',
    '@rnv/engine-rn-next',
    '@rnv/engine-rn-web',
    '@rnv/engine-rn-electron'
];

const SYNCED_TEMPLATES = [
    'renative-template-hello-world',
    'renative-template-blank'
];

export const versionCheck = async (c) => {
    logTask('versionCheck');

    if (c.runtime.isWrapper || c.runtime.versionCheckCompleted || c.files.project?.config?.skipAutoUpdate) {
        return true;
    }
    c.runtime.rnvVersionRunner = c.files.rnv?.package?.version;
    c.runtime.rnvVersionProject = c.files.project?.package?.devDependencies?.rnv;
    logTask(
        `versionCheck:rnvRunner:${c.runtime.rnvVersionRunner},rnvProject:${
            c.runtime.rnvVersionProject
        }`,
        chalk().grey
    );
    if (c.runtime.rnvVersionRunner && c.runtime.rnvVersionProject) {
        if (c.runtime.rnvVersionRunner !== c.runtime.rnvVersionProject) {
            const recCmd = chalk().white(`$ npx ${getCurrentCommand(true)}`);
            const actionNoUpdate = 'Continue and skip updating package.json';
            const actionWithUpdate = 'Continue and update package.json';
            const actionUpgrade = `Upgrade project to ${
                c.runtime.rnvVersionRunner
            }`;

            const { chosenAction } = await inquirerPrompt({
                message: 'What to do next?',
                type: 'list',
                name: 'chosenAction',
                choices: [actionNoUpdate, actionWithUpdate, actionUpgrade],
                warningMessage: `You are running $rnv v${chalk().red(
                    c.runtime.rnvVersionRunner
                )} against project built with rnv v${chalk().red(
                    c.runtime.rnvVersionProject
                )}. This might result in unexpected behaviour!
It is recommended that you run your rnv command with npx prefix: ${
    recCmd
} . or manually update your devDependencies.rnv version in your package.json.`
            });

            c.runtime.versionCheckCompleted = true;

            c.runtime.skipPackageUpdate = chosenAction === actionNoUpdate;

            if (chosenAction === actionUpgrade) {
                upgradeProjectDependencies(c, c.runtime.rnvVersionRunner);
            }
        }
    }
    return true;
};

export const upgradeProjectDependencies = (c, version) => {
    logTask('upgradeProjectDependencies');

    // const templates = c.files.project.config?.templates;
    // TODO: Make this dynamically injected
    // SYNC DEPS

    const devDependencies = c.files.project.package?.devDependencies;

    SYNCED_DEV_DEPS.forEach((dep) => {
        if (devDependencies?.[dep]) {
            devDependencies[dep] = version;
        }
    });
    SYNCED_TEMPLATES.forEach((templ) => {
        if (devDependencies?.[templ]) {
            devDependencies[templ] = version;
        }
        if (c.files.project.config?.templates?.[templ]?.version) {
            c.files.project.config.templates[templ].version = version;
        }
    });


    const dependencies = c.files.project.package?.dependencies;
    if (dependencies?.renative) {
        dependencies.renative = version;
    }

    writeFileSync(c.paths.project.package, c.files.project.package);

    c._requiresNpmInstall = true;

    writeFileSync(c.paths.project.config, c.files.project.config);
};

export const cleanPlaformAssets = async (c) => {
    logTask('cleanPlaformAssets');

    await cleanFolder(c.paths.project.assets.dir);
    mkdirSync(c.paths.project.assets.runtimeDir);
    return true;
};
