import {test,expect} from '@playwright/test';
import {cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
import {openPanel} from '../helpers/workspace';
import {useCanvas} from '../helpers/canvas';
let directory:string,bytes:Buffer,logging:Buffer;
test.describe.configure({ timeout: 60000 });
test.beforeAll(async()=>{
 directory=await mkdtemp(join(tmpdir(),'described-module-settings-'));const folder=join(directory,'source'),archive=join(directory,'websocket.spacemod');
 await cp(resolve('modules/net-websocket'),folder,{recursive:true});await buildPortableModule(join(folder,'module.json'),archive,{typecheck:false});bytes=await readFile(archive);
 const logsFolder=join(directory,'logging'),logsArchive=join(directory,'logging.spacemod');await cp(resolve('modules/logging'),logsFolder,{recursive:true});await buildPortableModule(join(logsFolder,'module.json'),logsArchive,{typecheck:false});logging=await readFile(logsArchive);
});
test('module diagnostics export scoped lifecycle and selected provider logs, then release removed histories',async({page})=>{
 await useCanvas(page);await page.goto('/');await expect(page.locator('#status')).toHaveText('LANDED');await openPanel(page,'library');
 await page.locator('#code-module-file').setInputFiles({name:'logging.spacemod',mimeType:'application/zip',buffer:logging});
 const row=page.locator('#device-module-list > li').filter({has:page.locator('input[data-module-id="spacelab.logging"]')});
 await row.locator('input[type=checkbox]').check();await row.locator('input[type=radio]').check();await page.locator('#apply-device-modules').click();
 await expect(page.locator('#device-module-status')).toContainText('enabled for this game');
 const report=async()=>{const pending=page.waitForEvent('download');await page.locator('#export-log').evaluate((button:HTMLButtonElement)=>button.click());return JSON.parse(await readFile(await (await pending).path(),'utf8'));};
 const first=await report();expect(first.moduleLogs.format).toBe('space-sim-module-logs/1');
 expect(first.moduleLogs.host).toEqual(expect.arrayContaining([expect.objectContaining({module:{id:'spacelab.logging',version:'0.1.0'},event:'module.initialized'})]));
 expect(first.moduleLogs.modules.flat()).toEqual(expect.arrayContaining([expect.objectContaining({module:{id:'spacelab.logging',version:'0.1.0'},event:'logging.ready'})]));
 expect(first.moduleLogs.host.length).toBeLessThanOrEqual(512);
 // Applying the same graph publishes the new guide lease before releasing the old candidate.
 await page.locator('#apply-device-modules').click();await expect(page.locator('#device-module-status')).toContainText('enabled for this game');
 await openPanel(page,'manual');await page.locator('#manual-tab-creators').click();await page.locator('#manual-search').fill('Module logging');
 await expect(page.locator('.manual-topic b').filter({hasText:/^Module logging$/})).toHaveCount(1);await openPanel(page,'library');
 await row.locator('input[type=checkbox]').uncheck();await page.locator('#apply-device-modules').click();await expect(page.locator('#device-module-status')).toContainText('enabled for this game');
 const second=await report();expect(second.moduleLogs.modules).toEqual([]);expect(second.moduleLogs.host).toEqual(expect.arrayContaining([expect.objectContaining({event:'candidate.disposed'})]));
});
test.afterAll(async()=>{await rm(directory,{recursive:true,force:true});});
test('imported module configuration shows descriptions and rejects invalid increments without replacing the active world',async({page})=>{
 await useCanvas(page);await page.goto('/');await expect(page.locator('#status')).toHaveText('LANDED');await openPanel(page,'library');
 await page.locator('#code-module-file').setInputFiles({name:'websocket.spacemod',mimeType:'application/zip',buffer:bytes});
 const row=page.locator('#device-module-list > li').filter({has:page.locator('input[data-module-id="spacelab.net-websocket"]')});
 await expect(row).toBeVisible();await row.locator('input[type=checkbox]').check();
 const timeout=row.getByLabel('Connection timeout (ms)',{exact:true});await expect(timeout).toHaveAttribute('step','1');
 await expect(row).toContainText('Maximum wait for a WebSocket connection to open.');await expect(timeout).toHaveAttribute('aria-describedby',/.+-help/);
 const world=await page.locator('#debug').evaluate(el=>JSON.parse(el.textContent!).world);
 await timeout.fill('10000.5');await timeout.blur();await expect(page.locator('#device-module-status')).toContainText('increment');
 expect(await page.locator('#debug').evaluate(el=>JSON.parse(el.textContent!).world)).toBe(world);
 await timeout.fill('15000');await timeout.blur();await expect(page.locator('#device-module-status')).toContainText('New world required');
});
