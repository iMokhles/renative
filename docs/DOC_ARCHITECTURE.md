# Documentation for ReNative Architecture

---

<img src="https://github.com/pavjacko/renative/blob/develop/docs/images/ic_arch.png?raw=true" width=50 height=50 />

## Architecture

Build Process

<table>
  <tr>
    <th>
    <img src="https://github.com/pavjacko/renative/blob/develop/docs/images/rnv_arch1.png?raw=true" />
    </th>
  </tr>
</table>

Folder Structure (Generated Project)

    .
    ├── appConfigs                  # Application flavour configuration files/assets
    │   └── helloWorld              # Example application flavour
    │       ├── assets              # Platform assets injected to `./platformAssets`
    │       ├── builds              # Platform files injected to `./platformBuilds`
    │       └── renative.json       # Application flavour config
    ├── platformAssets              # Generated cross-platform assets
    ├── platformBuilds              # Generated platform app projects
    ├── projectConfig               # Project configuration files/assets
    │   ├── fonts                   # Folder for all custom fonts
    │   └── builds                  # Fonts configuration
    ├── src                         # Source files
    └── renative.json           # React Native Plugins configuration


### Override Mechanism

ReNative support flexible override mechanism which allows you customise your project to great degree

<table>
  <tr>
    <th>
    <img src="https://github.com/pavjacko/renative/blob/develop/docs/images/rnv_arch2.png?raw=true" />
    </th>
  </tr>
</table>