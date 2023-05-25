import { promises, constants, createWriteStream, createReadStream } from 'fs';
import { dirname } from 'path';
import { extend } from 'got';
import FormData from 'form-data';
import { getInput, info, setOutput, error, setFailed } from '@actions/core';
import { context } from '@actions/github';

async function compress(srcFolder, zipFilePath) {
  const archiver = require('archiver');

  const targetBasePath = dirname(zipFilePath);

  if (targetBasePath === srcFolder) {
    throw new Error('Source and target folder must be different.');
  }
  try {
    await promises.access(srcFolder, constants.R_OK | constants.W_OK);
    await promises.access(targetBasePath, constants.R_OK | constants.W_OK);
  } catch (e) {
    throw new Error(`Permission error: ${e.message}`);
  }

  const output = createWriteStream(zipFilePath);
  const zipArchive = archiver('zip');

  return new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', (err) => {
      reject(err);
    });

    zipArchive.pipe(output);
    zipArchive.directory(srcFolder, false);
    zipArchive.finalize();
  });
}

async function runAction() {


  // http://username:password@example.com/  
  const allureServerUrl = new URL(getInput('allure-server-url', { required: true }));
  // getInput returns empty string in case no input passed, which is fine for us
  allureServerUrl.username = getInput('username')
  allureServerUrl.password = getInput('password')

  await compress(getInput('allure-results', { required: true }), './allure-results.zip')
  info(`Created compressed ./allure-results.zip`)

  const defaultGot = extend({
    prefixUrl: allureServerUrl,
    responseType: 'json'
  });

  const form = new FormData();
  info(`Uploading compressed ./allure-results.zip`)
  form.append('allureResults', createReadStream('allure-results.zip'));
  const resultsResp = await defaultGot('api/result', {
    method: 'POST',
    body: form,
  })

  info(`Upload done: ${resultsResp.body}`)

  const results_id = resultsResp.body.uuid
  const inputPath = getInput('path', { required: true })
  const allureReportPath = inputPath == 'DEFAULT_PATH' ? context.repo.repo : inputPath
  info(`Triggering report generation for ${allureReportPath}`)
  const reportUrl = await defaultGot('api/report', {
    method: 'POST',
    json: {
      reportSpec: {
        path: [allureReportPath],
        executorInfo: {
          buildUrl: getInput('buildUrl', { required: true })
        },
      },
      results: [results_id],
      deleteResults: true,
    },
  });

  info(`Report generation done: ${reportUrl.body}`)

  info(`========================================================================`)
  info(`REPORT URL: ${reportUrl.body.url}`)
  info(`========================================================================`)

  setOutput("report-url", reportUrl.body.url)
}

runAction().catch(err => {
  error(err.message)
  setFailed(err.message);
})
