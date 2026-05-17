const baseHandler = require('./iol-dashboard.js');

function marketStatus(){
  const now=new Date(), h=(now.getUTCHours()-3+24)%24, m=now.getUTCMinutes();
  const d=now.getUTCHours()<3?(now.getUTCDay()+6)%7:now.getUTCDay();
  const mins=h*60+m, weekday=d>=1&&d<=5, open=weekday&&mins>=660&&mins<1020;
  return {isOpen:open,isWeekday:weekday,argTime:`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,status:open?'ABIERTO':(weekday?'CERRADO':'FIN DE SEMANA'),note:open?'Mercado argentino abierto. Precios en vivo con posible delay de IOL.':weekday?'Mercado cerrado. Los precios son del último cierre. No vas a poder operar hasta mañana 11hs.':'Es fin de semana. El mercado argentino reabre el lunes a las 11hs.'};
}

function cls(s){
  s=String(s||'').toUpperCase();
  if(/^(AL|GD|AE)\d+/.test(s))return'bono_dolar';
  if(/^(TX|TZX|TZXM|TZXY|TZXD)\d+/.test(s))return'bono_cer';
  if(/^S\d{2}[A-Z]\d/.test(s))return'lecap';
  if(['YPFD','PAMP','VIST','GGAL','BMA','TXAR','ALUA','TGSU2','CEPU','BYMA','COME','LOMA','EDN','TRAN','CRES','TGNO4','MIRG','SUPV','CVH','BBAR'].includes(s))return'accion_local';
  if(['SPY','QQQ','DIA','IWM','EEM','EFA','GLD','SLV','TLT','XLE','XLF','XLK','XLV','XLP','XLI'].includes(s))return'cedear_etf';
  if(['KO','PG','JNJ','WMT','COST','MCD','DIS','PFE','MRK'].includes(s))return'cedear_defensivo';
  if(['AAPL','MSFT','GOOGL','META','AMZN','NVDA','AMD','TSLA','NFLX','ORCL','CRM','INTC','CSCO','PYPL','MU','MSTR','COIN','BABA'].includes(s))return'cedear_tech';
  if(['JPM','BAC','WFC','GS','MS','V','MA','AXP','BRKB'].includes(s))return'cedear_financiero';
  if(['XOM','CVX','F','GM','BA','CAT'].includes(s))return'cedear_industrial';
  return'otro';
}

function label(score,risk){
  score=Number(score||0);
  if(score>=78&&(risk==='Verde'||risk==='Amarillo'))return'Muy buena oportunidad';
  if(score>=65&&risk!=='Rojo')return'Buena oportunidad';
  if(score>=50)return'Esperá mejor momento';
  if(score>=35)return'Mejor no entrar ahora';
  return'Evitar';
}

function explain(x){
  const ac=x.assetClass||cls(x.symbol), tp=x.tradePlan||{};
  const que={lecap:'Una letra del Tesoro argentino en pesos. Es como prestarle al gobierno por unos meses y cobrar un interés fijo.',bono_cer:'Un bono argentino que ajusta por inflación. Si la inflación sube, tu inversión acompaña ese ajuste.',bono_dolar:'Un bono argentino en dólares. Pagás en pesos, pero el valor se mueve con el dólar y la confianza del país.',accion_local:'Una acción argentina. Puede subir fuerte, pero también bajar fuerte por el humor del mercado local.',cedear_tech:'Un CEDEAR de tecnología de EE.UU. Comprás en pesos, pero seguís una acción extranjera. Sube y baja fuerte.',cedear_etf:'Un CEDEAR de un fondo con muchas empresas adentro. Es más diversificado que apostar a una sola acción.',cedear_defensivo:'Un CEDEAR defensivo de consumo o salud. Suele moverse menos que la tecnología agresiva.',cedear_financiero:'Un CEDEAR de banco o financiera de EE.UU. Riesgo medio.',cedear_industrial:'Un CEDEAR industrial o energético de EE.UU. Riesgo medio.',otro:'Activo financiero.'}[ac]||'Activo financiero.';
  let hacer='Hoy no fuerces la entrada. Esperar también es una decisión válida.';
  if(String(x.action||'').startsWith('Comprar')&&tp.suggestedAmountARS){hacer=`Podrías usar unos $${Number(tp.suggestedAmountARS).toLocaleString('es-AR')} como referencia. Si no tenés saldo libre, es compra teórica hasta liberar o cargar capital. `; if(tp.target1)hacer+=`Si llega a $${Number(tp.target1).toLocaleString('es-AR')} vendé una parte. `; if(tp.invalidation)hacer+=`Si baja a $${Number(tp.invalidation).toLocaleString('es-AR')} salí, porque la entrada falló.`;}
  else if(String(x.action||'').includes('seguimiento'))hacer='No compres todavía. Seguilo 2 o 3 días y entrá solo si confirma fuerza.';
  const riesgo={Verde:'Riesgo bajo.',Amarillo:'Riesgo medio. Manejable.',Naranja:'Riesgo medio-alto. Cuidado con cuánto le ponés.',Rojo:'Riesgo alto. Mejor evitar o usar muy poco.'}[x.riskColor]||'Riesgo no calculado.';
  return {label:label(x.score,x.riskColor),queEs:que,queHacer:hacer,riesgoFrase:riesgo,textoCompleto:`${que} ${hacer} ${riesgo}`};
}

function norm(x){
  const assetClass=x.assetClass||cls(x.symbol), human=x.human||explain({...x,assetClass});
  return {symbol:x.symbol,assetClass,label:x.label||human.label,explicacion:x.explicacion||human.textoCompleto,price:x.price??x.quote?.price??null,dailyPct:x.dailyPct??x.quote?.pct??null,score:x.score||0,riskColor:x.riskColor||'Amarillo',action:x.action||'Revisar',thesis:x.thesis||'',tradePlan:x.tradePlan||null,human};
}

function enrich(data){
  if(!data||typeof data!=='object')return data;
  const ms=marketStatus(); data.marketStatus=ms; if(data.dailyAnalysis)data.dailyAnalysis.marketStatus=ms;
  const held=new Set((data.dailyAnalysis?.holdings||[]).map(h=>String(h.symbol||'').toUpperCase()));
  const ranking=(data.recommendations||data.dailyAnalysis?.ranking||[]).map(norm);
  const current=(data.newOpportunities||data.dailyAnalysis?.newOpportunities||[]).map(norm);
  const extra=ranking.filter(x=>!held.has(String(x.symbol||'').toUpperCase())).filter(x=>x.score>=55&&x.riskColor!=='Rojo');
  const map=new Map(); [...current,...extra].forEach(x=>{if(x.symbol&&!map.has(x.symbol))map.set(x.symbol,x)});
  const opps=Array.from(map.values()).slice(0,5);
  data.recommendations=ranking; data.newOpportunities=opps; data.bestNewOpportunity=opps[0]||null;
  if(data.dailyAnalysis){data.dailyAnalysis.ranking=ranking;data.dailyAnalysis.newOpportunities=opps;data.dailyAnalysis.bestNewOpportunity=data.bestNewOpportunity;}
  if(data.bestNewOpportunity){data.mainRecommendation=`${data.bestNewOpportunity.label}: ${data.bestNewOpportunity.symbol}`; if(data.dailyReport)data.dailyReport.mainRecommendation=data.mainRecommendation;}
  data.universeSummary={...(data.universeSummary||{}),humanized:true,note:'Respuesta enriquecida con estado de mercado, etiquetas humanas y explicaciones simples. Solo lectura.'};
  return data;
}

module.exports=async function handler(req,res){
  const chunks=[]; const fake={statusCode:200,headers:{},status(c){this.statusCode=c;return this},setHeader(k,v){this.headers[k.toLowerCase()]=v;return this},send(b){chunks.push(typeof b==='string'?b:JSON.stringify(b))}};
  await baseHandler(req,fake);
  let data; try{data=JSON.parse(chunks.join(''))}catch{data={ok:false,error:'Respuesta base no JSON',raw:chunks.join('').slice(0,500)}}
  const out=fake.statusCode>=200&&fake.statusCode<300?enrich(data):data;
  res.status(fake.statusCode).setHeader('content-type','application/json; charset=utf-8');
  res.send(JSON.stringify(out));
};
