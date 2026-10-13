export const BRANCHES = [
  {id:'santa-lucia',name:'Santa Lucía · Medellín'},
  {id:'niquia',name:'Niquía · Bello'}
];
export const STATUS={preparing:{label:'En preparación',tone:'blue'},ready:{label:'Listo para despacho',tone:'amber'},dispatched:{label:'Despachado',tone:'green'},delivered:{label:'Entregado',tone:'green'},cancelled:{label:'Cancelado',tone:'red'}};
export const PAYMENT={transfer:'Transferencia',cash_prepaid:'Efectivo confirmado',addi:'Addi',sistecredito:'Sistecrédito'};
export const formatMoney=value=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(value||0));
export const formatDateTime=value=>value?new Intl.DateTimeFormat('es-CO',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Bogota'}).format(new Date(value)):'Sin definir';
