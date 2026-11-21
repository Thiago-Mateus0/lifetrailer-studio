const { chromium } = require('playwright'); const fs=require('fs');
(async()=>{ const chave=fs.readFileSync('/tmp/lt-chave.txt','utf8').trim();
 const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1280,height:800}}); const p=await ctx.newPage();
 await p.goto('http://localhost:5173/'); await p.getByText('Registrar este aparelho').click();
 await p.locator('input').first().fill(chave); await p.getByRole('button',{name:'Registrar'}).click(); await p.waitForTimeout(1500);
 await ctx.storageState({path:process.env.DEMO_ESTADO||'/tmp/lt-demo-estado.json'}); await b.close(); console.log('ok');})();
