'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/settings.js'), 'utf8');
function fn(name) { const a=source.indexOf(`async function ${name}(`); return source.slice(a,source.indexOf('\n}',a)+2); }
test('late save/check feedback cannot supersede clearing the secret', async () => {
 for (const pending of ['save', 'check']) {
  const nodes = new Map(['notif-status','brrr-secret','secret-preview'].map(id=>[id,{value:'fixture_secret_1234',textContent:'',classList:{remove(){},add(){}}}]));
  let finish;
  const context={currentMember:{id:1},pushRegistrationRequest:null,document:{getElementById:id=>nodes.get(id)},hasExistingSecret:async()=>true,
   fetch:async(_url,opts)=>({ok:true,json:async()=>{
    const clear=opts.body && JSON.parse(opts.body).clear_secret;
    if (clear) return {has_secret:false};
    return new Promise(resolve=>{finish=resolve;});
   }})};
  vm.createContext(context);vm.runInContext(fn('saveNotifications')+'\n'+fn('checkNotificationRegistration'),context);
  const old=pending==='save'?context.saveNotifications(false):context.checkNotificationRegistration();
  await new Promise(resolve=>setImmediate(resolve));
  await context.saveNotifications(true);
  finish(pending==='save'?{has_secret:true,verification:{message:'OLD SECRET VERIFIED'}}:{message:'OLD SECRET VERIFIED'});
  await old;
  assert.equal(nodes.get('notif-status').textContent,'Secret cleared.',pending);
 }
});
