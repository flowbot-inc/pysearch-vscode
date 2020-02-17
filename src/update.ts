import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as util from 'util';
const axios = require('axios').default;
import { window } from 'vscode';


function getVersionFrom (data: string) {
  const match = data.match(/(version) (\d+.\d+.\d+)/)
  return match != null && match.length > 0 ? match[match.length - 1] : null
}

function getSizeFrom (data: string) {
  const match = data.match(/size (\d+)/)
  return match != null && match.length > 0 ? Number(match[1]) : null
}

function getVersionFromOutput (output: string) {
  const match = output.match(/(\d+(.\d+)?)(.\d+)?(_\d+)?(?:-\w+)?/)
  return match != null && match.length > 0 ? match[0] : null
}

function getInstalledServerVersion (serverPath: string, serverName: string) {
  return new Promise((resolve, reject) => {
    const childProcess = cp.spawn(serverPath, ['--version'])
    childProcess.on('error', err => {
      reject(err)
    })

    let stdOut = ''
    childProcess.stdout.on('data', chunk => stdOut += chunk.toString())
    childProcess.on('close', exitCode => {
      if (exitCode !== 0) {
        reject(new Error('Server version check exited with nonzero exit code'))
      } else if (exitCode === 0) {
        if (stdOut.length > 0) {
          const version = getVersionFromOutput(stdOut)
          if (version == null) {
            reject(new Error('Bad version number'))
          }
          resolve(version)
        }
        reject(new Error('Failed to read server output on version check'))
      }
    })
  })
}


function getSysInfo () {
  const platform = (() => {
    switch (os.platform()) {
      case 'darwin':
        return 'apple-darwin'
      case 'linux':
        return 'unknown-linux-gnu'
      case 'win32':
        return 'pc-windows-gnu'
      default:
        return 'unsupported'
    }
  })()

  const architecture = (() => {
    switch (os.arch()) {
      case 'x64':
        return 'x86_64'
      default:
        return 'unsupported'
    }
  })()

  const triple = util.format('%s-%s', architecture, platform)
  if (triple.includes('unsupported')) {
    throw Error(util.format('Platform not supported (%s)', triple))
  }

  return triple
}


export async function getServerInfo (serverPath: string, serverName: string) {
  const triple = getSysInfo()
  const url = util.format(
    'https://%s.s3-us-west-2.amazonaws.com/info/%s/latest',
    serverName,
    triple
  )
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'text'
  })
  const body = await response.data
  const serverIsInstalled = fs.existsSync(serverPath)
  const installedServerSize = serverIsInstalled ? fs.statSync(serverPath).size : 0
  const installedServerVersion = serverIsInstalled ? await getInstalledServerVersion(serverPath, serverName).catch((err) => { console.log(err); 0 }) : 0

  return {
    triple: triple,
    latestSize: getSizeFrom(body),
    latestVersion: getVersionFrom(body),
    installedServerVersion: installedServerVersion,
    installedServerSize: installedServerSize
  }
}

async function downloadServer (serverPath:string, serverName:string, version: string, triple: string, callback: () => void) {
  console.log(util.format('Downloading %s binary...', serverName))

  const serverDir = path.join(__dirname, '../bin')
  if (!fs.existsSync(serverDir)){
      fs.mkdirSync(serverDir);
  }

  const url = util.format(
    'https://%s.s3-us-west-2.amazonaws.com/bin/%s/%s/%s',
    serverName,
    version.replace(/\./g, '_'),
    triple,
    serverName
  )
  const writer = fs.createWriteStream(serverPath)
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    responseEncoding: null
  })
  response.data.pipe(writer)
  fs.chmodSync(serverPath, 755)

  writer.on('finish', () => {
    console.log('Server download successful!')
    callback()
  })
  writer.on('error', () => {
    console.log('Unable to download binary')
  })
}


export function installServerIfRequired (serverPath: string, serverInfo: Record<string, any>, serverName: string) {
  return new Promise(async (resolve, reject) => {
    if (
      serverInfo &&
      serverInfo.latestSize === serverInfo.installedServerSize &&
      serverInfo.latestVersion === serverInfo.installedServerVersion
    ) {
      resolve()
    } else {
      if (fs.existsSync(serverPath)) { fs.unlinkSync(serverPath) }
      await downloadServer(serverPath, serverName, serverInfo.latestVersion, serverInfo.triple, resolve)
        .catch((err) => {
          console.error(err)
        })
    }
  })
}
