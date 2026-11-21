const { chromium } = require('playwright');
exports.abrir = async (video) => {
 const b = await chromium.launch();
 const ctx = await b.newContext({viewport:{width:1280,height:800},storageState:process.env.DEMO_ESTADO||'/tmp/lt-demo-estado.json',...(video?{recordVideo:{dir:(process.env.DEMO_VIDEO||'/tmp/lt-demo-video'),size:{width:1280,height:800}}}:{})});
 const p = await ctx.newPage();
 await p.goto('http://localhost:5173/'); await p.waitForTimeout(1000);
 await p.getByText('Marcos').first().click();
 for (const d of '1111') await p.getByRole('button',{name:d,exact:true}).click();
 await p.waitForTimeout(1500);
 return {b,ctx,p};
};
