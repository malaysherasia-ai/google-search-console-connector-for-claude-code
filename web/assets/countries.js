// Search Console reports countries as ISO 3166-1 alpha-3 codes; Intl wants alpha-2.
const A3 =
  "afg:AF,alb:AL,dza:DZ,and:AD,ago:AO,atg:AG,arg:AR,arm:AM,aus:AU,aut:AT,aze:AZ,bhs:BS,bhr:BH,bgd:BD,brb:BB,blr:BY,bel:BE,blz:BZ,ben:BJ,btn:BT,bol:BO,bih:BA,bwa:BW,bra:BR,brn:BN,bgr:BG,bfa:BF,bdi:BI,cpv:CV,khm:KH,cmr:CM,can:CA,caf:CF,tcd:TD,chl:CL,chn:CN,col:CO,com:KM,cog:CG,cod:CD,cri:CR,civ:CI,hrv:HR,cub:CU,cyp:CY,cze:CZ,dnk:DK,dji:DJ,dma:DM,dom:DO,ecu:EC,egy:EG,slv:SV,gnq:GQ,eri:ER,est:EE,swz:SZ,eth:ET,fji:FJ,fin:FI,fra:FR,gab:GA,gmb:GM,geo:GE,deu:DE,gha:GH,grc:GR,grd:GD,gtm:GT,gin:GN,gnb:GW,guy:GY,hti:HT,hnd:HN,hun:HU,isl:IS,ind:IN,idn:ID,irn:IR,irq:IQ,irl:IE,isr:IL,ita:IT,jam:JM,jpn:JP,jor:JO,kaz:KZ,ken:KE,kir:KI,prk:KP,kor:KR,kwt:KW,kgz:KG,lao:LA,lva:LV,lbn:LB,lso:LS,lbr:LR,lby:LY,lie:LI,ltu:LT,lux:LU,mdg:MG,mwi:MW,mys:MY,mdv:MV,mli:ML,mlt:MT,mhl:MH,mrt:MR,mus:MU,mex:MX,fsm:FM,mda:MD,mco:MC,mng:MN,mne:ME,mar:MA,moz:MZ,mmr:MM,nam:NA,nru:NR,npl:NP,nld:NL,nzl:NZ,nic:NI,ner:NE,nga:NG,mkd:MK,nor:NO,omn:OM,pak:PK,plw:PW,pse:PS,pan:PA,png:PG,pry:PY,per:PE,phl:PH,pol:PL,prt:PT,qat:QA,rou:RO,rus:RU,rwa:RW,kna:KN,lca:LC,vct:VC,wsm:WS,smr:SM,stp:ST,sau:SA,sen:SN,srb:RS,syc:SC,sle:SL,sgp:SG,svk:SK,svn:SI,slb:SB,som:SO,zaf:ZA,ssd:SS,esp:ES,lka:LK,sdn:SD,sur:SR,swe:SE,che:CH,syr:SY,twn:TW,tjk:TJ,tza:TZ,tha:TH,tls:TL,tgo:TG,ton:TO,tto:TT,tun:TN,tur:TR,tkm:TM,tuv:TV,uga:UG,ukr:UA,are:AE,gbr:GB,usa:US,ury:UY,uzb:UZ,vut:VU,vat:VA,ven:VE,vnm:VN,yem:YE,zmb:ZM,zwe:ZW,hkg:HK,mac:MO,pri:PR,gum:GU,vir:VI,abw:AW,cuw:CW,bmu:BM,cym:KY,glp:GP,mtq:MQ,reu:RE,guf:GF,myt:YT,ncl:NC,pyf:PF,grl:GL,fro:FO,gib:GI,imn:IM,jey:JE,ggy:GG,ala:AX,xkk:XK,sxm:SX,maf:MF,blm:BL,aia:AI,vgb:VG,msr:MS,tca:TC,asm:AS,mnp:MP,cok:CK,niu:NU,spm:PM,wlf:WF,shn:SH,flk:FK,esh:EH,bes:BQ,iot:IO";
const MAP = new Map(A3.split(",").map((p) => p.split(":")));
let names;
try {
  names = new Intl.DisplayNames(["en"], { type: "region" });
} catch {}

export function countryName(code) {
  if (code === "zzz") return "Unknown region";
  const a2 = MAP.get(code);
  try {
    return (a2 && names?.of(a2)) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}
