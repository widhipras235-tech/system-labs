const CACHE="system-labs"

const FILES=[

"/promo-system/app/",
"/promo-system/app/index.html",
"/promo-system/app/app.js",
"/promo-system/app/style.css",
"/promo-system/db/promo.json"

]

self.addEventListener("install",e=>{

e.waitUntil(

caches.open(CACHE).then(c=>c.addAll(FILES))

)

})

self.addEventListener("fetch",e=>{

e.respondWith(

caches.match(e.request).then(r=>r||fetch(e.request))

)

})