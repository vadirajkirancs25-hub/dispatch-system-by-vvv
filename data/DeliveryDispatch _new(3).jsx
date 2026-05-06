import { useState, useMemo, useEffect } from "react";

// ─── Core constants (sourced from constraints.csv) ────────────────────────────
const GRID = 10;
const MAX_ORDERS_PER_RIDER    = 2;   // max_active_orders_per_agent = 2
const DECISION_LATENCY_TARGET = 5;   // decision_latency_target_seconds = 5
const DEFAULT_SLA_MINUTES     = 50;  // default_sla_minutes = 50

// Priority weights from CSV: high=1.5, normal=1.0, low=0.8
// Applied as score boost: higher weight = bigger reduction = rider favoured more
const PRIORITY_BOOST = {
  urgent:   53,  // 35 * 1.5  (urgent treated as high per CSV)
  high:     30,  // 20 * 1.5
  standard: 10,  // 10 * 1.0
  low:       8,  // 10 * 0.8
};
const PRIORITY_ORDER = { urgent: 0, high: 1, standard: 2, low: 3 };

// ─── Pure utilities ────────────────────────────────────────────────────────────
const rand  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const dist  = (a, b)     => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const clamp = (v, lo, hi)=> Math.max(lo, Math.min(hi, v));

function eta(rider, order, delay) {
  return order.prepTime + dist(rider.location, order.location) + rider.activeOrders.length * 5 + delay;
}

function fairnessPenalty(rider, allRiders) {
  const avg = allRiders.reduce((s, r) => s + r.activeOrders.length, 0) / allRiders.length;
  return Math.abs(rider.activeOrders.length + 1 - avg) * 10;
}

function score(rider, order, allRiders, delay) {
  const d   = dist(rider.location, order.location);
  const e   = eta(rider, order, delay);
  const sla = Math.max(0, e - order.sla) * 4;
  const fp  = fairnessPenalty(rider, allRiders);
  const rb  = rider.rating * 3;
  const pb  = PRIORITY_BOOST[order.priority] ?? 0;
  return +(0.4*d + 0.35*sla + 0.2*fp - 0.2*rb - 0.3*pb).toFixed(2);
}

function variance(riders) {
  if (!riders.length) return 0;
  const loads = riders.map(r => r.activeOrders.length);
  const avg   = loads.reduce((s,v)=>s+v,0)/loads.length;
  return +(loads.reduce((s,v)=>s+(v-avg)**2,0)/loads.length).toFixed(2);
}

// ─── Demo data ─────────────────────────────────────────────────────────────────
const RIDER_NAMES = ["Arun K.","Priya M.","Ravi S.","Meena T.","Suresh B.","Kavya R."];
const AREA_NAMES  = ["Koramangala","Indiranagar","HSR Layout","Whitefield","Jayanagar","BTM Layout","Marathahalli","Electronic City","Banashankari","Yelahanka"];

function makeDemoRiders() {
  return RIDER_NAMES.map((name, i) => ({
    id: `R${i+1}`, name,
    location: { x: rand(0,GRID), y: rand(0,GRID) },
    available: true,
    rating: +(Math.random()*1.5+3.5).toFixed(1),
    activeOrders: [], completedOrders: 0,
    vehicle: ["bike","scooter","cycle"][i%3],
  }));
}

function makeDemoOrders() {
  const priorities = ["low","standard","standard","high","urgent"];
  return Array.from({length:10},(_,i)=>({
    id: `ORD-${String(i+1).padStart(3,"0")}`,
    customer: `Customer ${i+1}`,
    area: AREA_NAMES[rand(0,AREA_NAMES.length-1)],
    timestamp: Date.now() + i*1000,
    location: { x: rand(0,GRID), y: rand(0,GRID) },
    prepTime: rand(5,15),
    priority: priorities[rand(0,priorities.length-1)],
    sla: DEFAULT_SLA_MINUTES,
    assignedRiderId: null,
    delivered: false,
    createdAt: new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}),
  }));
}

// ─── Design tokens ─────────────────────────────────────────────────────────────
const PRIORITY_CONFIG = {
  urgent:   { label:"Urgent",   bg:"#FEF2F2", text:"#991B1B", dot:"#EF4444", border:"#FECACA" },
  high:     { label:"High",     bg:"#FFFBEB", text:"#92400E", dot:"#F59E0B", border:"#FDE68A" },
  standard: { label:"Standard", bg:"#F0FDF4", text:"#166534", dot:"#22C55E", border:"#BBF7D0" },
  low:      { label:"Low",      bg:"#F8FAFC", text:"#475569", dot:"#94A3B8", border:"#CBD5E1" },
};

const STATUS_CONFIG = {
  pending:   { label:"Pending",    bg:"#FFF7ED", text:"#C2410C", icon:"⏳" },
  assigned:  { label:"In Transit", bg:"#EFF6FF", text:"#1D4ED8", icon:"🚴" },
  delivered: { label:"Delivered",  bg:"#F0FDF4", text:"#15803D", icon:"✅" },
};

function getOrderStatus(order) {
  if (order.delivered)        return "delivered";
  if (order.assignedRiderId)  return "assigned";
  return "pending";
}

function getSlaStatus(etaVal, sla) {
  if (etaVal > sla)          return { color:"#DC2626", label:"Breached", bg:"#FEE2E2" };
  if (etaVal > sla * 0.8)    return { color:"#D97706", label:"At Risk",  bg:"#FEF3C7" };
  return                            { color:"#16A34A", label:"On Track", bg:"#DCFCE7" };
}

// ─── Reusable atoms ────────────────────────────────────────────────────────────
function PriorityBadge({ priority }) {
  const c = PRIORITY_CONFIG[priority];
  return (
    <span style={{
      display:"inline-flex", alignItems:"center", gap:5,
      background:c.bg, color:c.text, border:`1px solid ${c.border}`,
      borderRadius:20, padding:"2px 10px", fontSize:11, fontWeight:600, letterSpacing:.3,
    }}>
      <span style={{width:6,height:6,borderRadius:"50%",background:c.dot,flexShrink:0}}/>
      {c.label}
    </span>
  );
}

function StatusBadge({ status }) {
  const c = STATUS_CONFIG[status];
  return (
    <span style={{
      background:c.bg, color:c.text,
      borderRadius:20, padding:"2px 10px", fontSize:11, fontWeight:600,
    }}>
      {c.icon} {c.label}
    </span>
  );
}

function KpiCard({ icon, label, value, sub, color="#1D4ED8", trend }) {
  return (
    <div style={{
      background:"#fff", borderRadius:16, padding:"20px 22px",
      border:"1px solid #E5E7EB", flex:1, minWidth:0,
      boxShadow:"0 1px 3px rgba(0,0,0,.06)",
    }}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <div style={{
          width:40, height:40, borderRadius:12,
          background:color+"18", display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:20,
        }}>{icon}</div>
        {trend && <span style={{fontSize:12,color:"#16A34A",fontWeight:600}}>{trend}</span>}
      </div>
      <div style={{fontSize:28,fontWeight:700,color:"#111827",lineHeight:1}}>{value}</div>
      <div style={{fontSize:13,color:"#6B7280",marginTop:4}}>{label}</div>
      {sub && <div style={{fontSize:11,color:"#9CA3AF",marginTop:2}}>{sub}</div>}
    </div>
  );
}

function RatingStars({ rating }) {
  return (
    <span style={{fontSize:12,color:"#F59E0B",fontWeight:600}}>
      {"★".repeat(Math.round(rating))}{"☆".repeat(5-Math.round(rating))} {rating}
    </span>
  );
}

// ─── Grid Map ─────────────────────────────────────────────────────────────────
function GridMap({ riders, orders }) {
  const riderMap = {}, orderMap = {};
  riders.forEach(r => { riderMap[`${r.location.x},${r.location.y}`] = r; });
  orders.forEach(o => {
    if (!o.delivered) orderMap[`${o.location.x},${o.location.y}`] = o;
  });

  const CELL = 38;
  return (
    <div>
      <div style={{display:"flex",gap:16,marginBottom:12,flexWrap:"wrap"}}>
        {[
          {dot:"#3B82F6",label:"Rider"},
          {dot:"#F59E0B",label:"Pending order"},
          {dot:"#8B5CF6",label:"In transit"},
          {dot:"#22C55E",label:"Delivered"},
        ].map(item=>(
          <div key={item.label} style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"#6B7280"}}>
            <div style={{width:10,height:10,borderRadius:3,background:item.dot}}/>
            {item.label}
          </div>
        ))}
      </div>

      <div style={{
        display:"grid",
        gridTemplateColumns:`repeat(${GRID+1}, ${CELL}px)`,
        gap:2, background:"#F3F4F6", borderRadius:12, padding:6,
        overflowX:"auto",
      }}>
        {Array.from({length:GRID+1},(_,row)=>{
          const y = GRID - row;
          return Array.from({length:GRID+1},(_,x)=>{
            const key = `${x},${y}`;
            const rider = riderMap[key];
            const order = orderMap[key];
            const done  = orders.find(o=>o.location.x===x&&o.location.y===y&&o.delivered);
            let bg="#fff", content=null, title=`(${x},${y})`;

            if (rider) {
              bg="#DBEAFE";
              content=<span style={{fontSize:9,fontWeight:700,color:"#1D4ED8",textAlign:"center",lineHeight:1.1}}>{rider.id}<br/>🏍</span>;
              title=`${rider.name} at (${x},${y})`;
            } else if (order?.assignedRiderId) {
              bg="#EDE9FE";
              content=<span style={{fontSize:8,fontWeight:600,color:"#6D28D9",textAlign:"center",lineHeight:1.2}}>🚴<br/>{order.id.replace("ORD-","#")}</span>;
            } else if (order) {
              bg="#FEF3C7";
              content=<span style={{fontSize:8,fontWeight:600,color:"#92400E",textAlign:"center",lineHeight:1.2}}>📦<br/>{order.id.replace("ORD-","#")}</span>;
            } else if (done) {
              bg="#DCFCE7";
              content=<span style={{fontSize:14,color:"#16A34A"}}>✓</span>;
            }

            return (
              <div key={key} title={title} style={{
                width:CELL, height:CELL, background:bg, borderRadius:6,
                display:"flex", alignItems:"center", justifyContent:"center",
                border:"1px solid #E5E7EB", cursor:rider||order?"default":"default",
                transition:"background .15s",
              }}>
                {content || <span style={{color:"#E5E7EB",fontSize:10}}>·</span>}
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}

// ─── Order row (for the list) ─────────────────────────────────────────────────
function OrderRow({ order, riders, delay, selected, onSelect, onDispatch, onComplete }) {
  const rider  = riders.find(r=>r.id===order.assignedRiderId);
  const etaVal = rider ? eta(rider, order, delay) : null;
  const sla    = etaVal ? getSlaStatus(etaVal, order.sla) : null;
  const status = getOrderStatus(order);

  return (
    <div
      onClick={()=>onSelect(order.id)}
      style={{
        background: selected ? "#EFF6FF" : "#fff",
        border: selected ? "1.5px solid #3B82F6" : "1px solid #E5E7EB",
        borderRadius:12, padding:"14px 16px", cursor:"pointer",
        transition:"all .15s", marginBottom:8,
      }}
    >
      {/* Top row */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontWeight:700,fontSize:13,color:"#111827"}}>{order.id}</span>
          <PriorityBadge priority={order.priority}/>
        </div>
        <StatusBadge status={status}/>
      </div>

      {/* Info row */}
      <div style={{display:"flex",gap:16,fontSize:12,color:"#6B7280",marginBottom:10,flexWrap:"wrap"}}>
        <span>📍 {order.area}</span>
        <span>⏱ Prep: {order.prepTime} min</span>
        <span>🎯 SLA: {order.sla} min</span>
        <span>🕐 {order.createdAt}</span>
        {rider && <span style={{color:"#1D4ED8"}}>🏍 {rider.name}</span>}
      </div>

      {/* SLA bar */}
      {etaVal !== null && (
        <div style={{marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:4}}>
            <span style={{color:"#6B7280"}}>ETA <b style={{color:sla.color}}>{etaVal} min</b> of {order.sla} min SLA</span>
            <span style={{
              background:sla.bg, color:sla.color, borderRadius:6,
              padding:"1px 7px", fontSize:10, fontWeight:600,
            }}>{sla.label}</span>
          </div>
          <div style={{height:4,background:"#F3F4F6",borderRadius:2}}>
            <div style={{
              height:4, borderRadius:2, background:sla.color,
              width:`${clamp((etaVal/order.sla)*100,0,100)}%`,
              transition:"width .3s",
            }}/>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{display:"flex",gap:8}} onClick={e=>e.stopPropagation()}>
        {!order.assignedRiderId && !order.delivered && (
          <button onClick={()=>onDispatch(order.id)} style={{
            background:"#1D4ED8", color:"#fff", border:"none",
            borderRadius:8, padding:"6px 14px", fontSize:12, fontWeight:600,
            cursor:"pointer",
          }}>
            🚀 Assign Rider
          </button>
        )}
        {order.assignedRiderId && !order.delivered && (
          <button onClick={()=>onComplete(order.id)} style={{
            background:"#16A34A", color:"#fff", border:"none",
            borderRadius:8, padding:"6px 14px", fontSize:12, fontWeight:600,
            cursor:"pointer",
          }}>
            ✅ Mark Delivered
          </button>
        )}
        <button onClick={()=>onSelect(order.id)} style={{
          background:"#F9FAFB", color:"#374151", border:"1px solid #E5E7EB",
          borderRadius:8, padding:"6px 14px", fontSize:12, fontWeight:500,
          cursor:"pointer",
        }}>
          🔍 Analyze
        </button>
      </div>
    </div>
  );
}

// ─── Rider card ───────────────────────────────────────────────────────────────
function RiderCard({ rider }) {
  const load   = rider.activeOrders.length / MAX_ORDERS_PER_RIDER;
  const color  = load >= 1 ? "#DC2626" : load >= .5 ? "#D97706" : "#16A34A";
  const status = load >= 1 ? "Full" : load > 0 ? "Busy" : "Free";

  return (
    <div style={{
      background:"#fff", border:"1px solid #E5E7EB",
      borderRadius:12, padding:"14px 16px",
      boxShadow:"0 1px 3px rgba(0,0,0,.05)",
    }}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
        <div style={{
          width:38, height:38, borderRadius:"50%",
          background:"#EFF6FF", display:"flex", alignItems:"center",
          justifyContent:"center", fontSize:18,
        }}>
          {rider.vehicle==="bike"?"🏍":rider.vehicle==="scooter"?"🛵":"🚲"}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:600,fontSize:13,color:"#111827"}}>{rider.name}</div>
          <div style={{fontSize:11,color:"#6B7280"}}>{rider.id} · {rider.vehicle}</div>
        </div>
        <span style={{
          fontSize:11, fontWeight:700, padding:"3px 9px",
          borderRadius:20, background:color+"18", color,
        }}>{status}</span>
      </div>

      <RatingStars rating={rider.rating}/>

      {/* Load bar */}
      <div style={{margin:"10px 0"}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#6B7280",marginBottom:4}}>
          <span>Capacity</span>
          <span style={{fontWeight:600,color}}>{rider.activeOrders.length}/{MAX_ORDERS_PER_RIDER} orders</span>
        </div>
        <div style={{height:6,background:"#F3F4F6",borderRadius:3}}>
          <div style={{
            height:6, borderRadius:3, background:color,
            width:`${load*100}%`, transition:"width .4s",
          }}/>
        </div>
      </div>

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:10}}>
        {[
          {label:"Location", value:`(${rider.location.x}, ${rider.location.y})`},
          {label:"Completed", value:`${rider.completedOrders} orders`},
        ].map(item=>(
          <div key={item.label} style={{background:"#F9FAFB",borderRadius:8,padding:"6px 10px"}}>
            <div style={{fontSize:10,color:"#9CA3AF"}}>{item.label}</div>
            <div style={{fontSize:12,fontWeight:500,color:"#374151"}}>{item.value}</div>
          </div>
        ))}
      </div>

      {rider.activeOrders.length>0 && (
        <div style={{marginTop:10,fontSize:11,color:"#6B7280"}}>
          Active: {rider.activeOrders.join(", ")}
        </div>
      )}
    </div>
  );
}

// ─── Score breakdown panel ─────────────────────────────────────────────────────
function ScorePanel({ order, riders, delay }) {
  const breakdown = useMemo(()=>{
    if (!order) return [];
    return riders
      .filter(r=>r.available && r.activeOrders.length < MAX_ORDERS_PER_RIDER)
      .map(r=>({
        rider:r,
        distance: dist(r.location, order.location),
        eta: eta(r, order, delay),
        score: score(r, order, riders, delay),
      }))
      .sort((a,b)=>a.score-b.score);
  },[order, riders, delay]);

  if (!order) return (
    <div style={{textAlign:"center",padding:"40px 20px",color:"#9CA3AF"}}>
      <div style={{fontSize:40,marginBottom:12}}>🔍</div>
      <div style={{fontSize:14,fontWeight:500,color:"#6B7280"}}>Select an order to analyze rider options</div>
      <div style={{fontSize:12,marginTop:4}}>Click any order from the list to see which rider is the best fit</div>
    </div>
  );

  const statusVal = getOrderStatus(order);

  return (
    <div>
      {/* Order summary */}
      <div style={{
        background:"#F8FAFC", border:"1px solid #E2E8F0",
        borderRadius:12, padding:"14px 16px", marginBottom:16,
      }}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
          <span style={{fontWeight:700,fontSize:14,color:"#111827"}}>{order.id}</span>
          <PriorityBadge priority={order.priority}/>
          <StatusBadge status={statusVal}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[
            {label:"Area",     value:order.area},
            {label:"SLA",      value:`${order.sla} min`},
            {label:"Prep time",value:`${order.prepTime} min`},
            {label:"Location", value:`(${order.location.x}, ${order.location.y})`},
          ].map(item=>(
            <div key={item.label}>
              <div style={{fontSize:11,color:"#9CA3AF"}}>{item.label}</div>
              <div style={{fontSize:12,fontWeight:500,color:"#374151"}}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Score explanation */}
      <div style={{
        background:"#FFFBEB", border:"1px solid #FDE68A",
        borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:12, color:"#92400E",
      }}>
        💡 <b>How scoring works:</b> Lower score = better match. We consider distance, SLA risk, rider workload, rating, and order priority.
      </div>

      {breakdown.length === 0 ? (
        <div style={{textAlign:"center",padding:"20px",color:"#9CA3AF",fontSize:13}}>
          No available riders right now. All riders are at full capacity.
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {breakdown.map(({rider,distance:d,eta:e,score:s},idx)=>{
            const slaInfo = getSlaStatus(e, order.sla);
            return (
              <div key={rider.id} style={{
                background: idx===0 ? "#EFF6FF" : "#fff",
                border: idx===0 ? "1.5px solid #3B82F6" : "1px solid #E5E7EB",
                borderRadius:10, padding:"12px 14px",
              }}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:18}}>{rider.vehicle==="bike"?"🏍":rider.vehicle==="scooter"?"🛵":"🚲"}</span>
                    <div>
                      <div style={{fontWeight:600,fontSize:13,color:"#111827"}}>{rider.name}</div>
                      <RatingStars rating={rider.rating}/>
                    </div>
                    {idx===0 && (
                      <span style={{
                        background:"#1D4ED8",color:"#fff",fontSize:10,fontWeight:700,
                        borderRadius:20,padding:"2px 8px",
                      }}>Best Match</span>
                    )}
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:20,fontWeight:700,color: idx===0?"#1D4ED8":"#374151"}}>{s}</div>
                    <div style={{fontSize:10,color:"#9CA3AF"}}>score</div>
                  </div>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
                  {[
                    {label:"Distance", value:`${d} km`},
                    {label:"ETA",      value:`${e} min`, color: slaInfo.color},
                    {label:"Load",     value:`${rider.activeOrders.length}/${MAX_ORDERS_PER_RIDER}`},
                    {label:"SLA",      value:slaInfo.label, color:slaInfo.color},
                  ].map(item=>(
                    <div key={item.label} style={{background:"#F9FAFB",borderRadius:7,padding:"6px 8px",textAlign:"center"}}>
                      <div style={{fontSize:10,color:"#9CA3AF"}}>{item.label}</div>
                      <div style={{fontSize:12,fontWeight:600,color:item.color||"#374151"}}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Activity log ─────────────────────────────────────────────────────────────
function ActivityLog({ log }) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      {log.map((entry,i)=>(
        <div key={i} style={{
          display:"flex", gap:10, alignItems:"flex-start",
          padding:"10px 12px",
          background: i===0 ? "#EFF6FF" : "#F9FAFB",
          borderRadius:8,
          borderLeft: i===0 ? "3px solid #3B82F6" : "3px solid #E5E7EB",
        }}>
          <span style={{fontSize:16,flexShrink:0}}>{entry.icon}</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12,color:"#374151"}}>{entry.msg}</div>
            <div style={{fontSize:10,color:"#9CA3AF",marginTop:1}}>{entry.time}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function DeliveryDispatch() {
  const [riders,  setRiders]  = useState(makeDemoRiders);
  const [orders,  setOrders]  = useState(makeDemoOrders);
  const [delay,   setDelay]   = useState(3);
  const [selId,   setSelId]   = useState("ORD-001");
  const [log,     setLog]     = useState([{icon:"🟢",msg:"System online. Demo data loaded.",time:new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}]);
  const [view,    setView]    = useState("orders");   // orders | riders | scores
  const [filter,  setFilter]  = useState("all");      // all | pending | assigned | delivered

  const now = () => new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"});

  function addLog(icon, msg) {
    setLog(prev=>[{icon,msg,time:now()},...prev].slice(0,15));
  }

  const pending   = useMemo(()=>orders.filter(o=>!o.assignedRiderId&&!o.delivered),[orders]);
  const inTransit = useMemo(()=>orders.filter(o=>o.assignedRiderId&&!o.delivered),[orders]);
  const delivered = useMemo(()=>orders.filter(o=>o.delivered),[orders]);
  const selectedOrder = orders.find(o=>o.id===selId)||null;

  const filteredOrders = useMemo(()=>{
    if (filter==="pending")   return pending;
    if (filter==="assigned")  return inTransit;
    if (filter==="delivered") return delivered;
    return orders;
  },[filter,orders,pending,inTransit,delivered]);

  function reset() {
    setRiders(makeDemoRiders());
    setOrders([]);
    setSelId("");
    setDelay(3);
    setFilter("all");
    setLog([{icon:"🔄",msg:"Dashboard reset. No pending orders — use '+ New Order' to begin.",time:now()}]);
  }

  function addOrder() {
    const ps = ["low","standard","standard","high","urgent"];
    const id = `ORD-${String(orders.length+1).padStart(3,"0")}`;
    const o  = {
      id, customer:`Customer ${orders.length+1}`,
      area: AREA_NAMES[rand(0,AREA_NAMES.length-1)],
      timestamp: Date.now(), createdAt: now(),
      location: {x:rand(0,GRID),y:rand(0,GRID)},
      prepTime: rand(5,15), priority: ps[rand(0,ps.length-1)],
      sla: DEFAULT_SLA_MINUTES, assignedRiderId:null, delivered:false,
    };
    setOrders(prev=>[...prev,o]);
    setSelId(id);
    addLog("📦", `New order ${id} received — ${o.area} (${o.priority} priority)`);
  }

  function dispatchOne(orderId) {
    const order = orders.find(o=>o.id===orderId);
    if (!order||order.delivered||order.assignedRiderId) return;
    const eligible = riders.filter(r=>r.available&&r.activeOrders.length<MAX_ORDERS_PER_RIDER);
    if (!eligible.length) { addLog("⚠️",`No available riders for ${orderId}.`); return; }

    const best = eligible
      .map(r=>({r,s:score(r,order,riders,delay)}))
      .sort((a,b)=>a.s-b.s)[0];

    setOrders(prev=>prev.map(o=>o.id===orderId?{...o,assignedRiderId:best.r.id}:o));
    setRiders(prev=>prev.map(r=>r.id===best.r.id?{...r,activeOrders:[...r.activeOrders,orderId]}:r));
    addLog("🚀",`${orderId} assigned to ${best.r.name} (score: ${best.s})`);
  }

  function dispatchAll() {
    const sorted = [...pending].sort(
      (a,b)=>PRIORITY_ORDER[a.priority]-PRIORITY_ORDER[b.priority]||a.timestamp-b.timestamp
    );
    let nr = riders.map(r=>({...r,activeOrders:[...r.activeOrders]}));
    let no = [...orders];
    let count = 0;

    for (const order of sorted) {
      const el = nr.filter(r=>r.available&&r.activeOrders.length<MAX_ORDERS_PER_RIDER);
      if (!el.length) continue;
      const best = el.map(r=>({r,s:score(r,order,nr,delay)})).sort((a,b)=>a.s-b.s)[0];
      no = no.map(o=>o.id===order.id?{...o,assignedRiderId:best.r.id}:o);
      nr = nr.map(r=>r.id===best.r.id?{...r,activeOrders:[...r.activeOrders,order.id]}:r);
      count++;
    }
    setOrders(no); setRiders(nr);
    addLog("⚡",`Batch dispatch complete — ${count} orders assigned automatically`);
  }

  function markDelivered(orderId) {
    const order = orders.find(o=>o.id===orderId);
    if (!order||!order.assignedRiderId||order.delivered) return;
    const rider = riders.find(r=>r.id===order.assignedRiderId);
    setOrders(prev=>prev.map(o=>o.id===orderId?{...o,delivered:true}:o));
    setRiders(prev=>prev.map(r=>r.id===order.assignedRiderId?{
      ...r, location:order.location,
      activeOrders:r.activeOrders.filter(id=>id!==orderId),
      completedOrders:r.completedOrders+1,
    }:r));
    addLog("✅",`${orderId} delivered by ${rider?.name||order.assignedRiderId}. Rider moved to delivery location.`);
  }

  const TAB = (id,label,count)=>(
    <button onClick={()=>setView(id)} style={{
      padding:"8px 16px", borderRadius:8, fontSize:13, cursor:"pointer",
      fontWeight: view===id ? 600 : 400,
      background: view===id ? "#fff" : "transparent",
      color: view===id ? "#1D4ED8" : "#6B7280",
      border: view===id ? "1px solid #E5E7EB" : "1px solid transparent",
      boxShadow: view===id ? "0 1px 3px rgba(0,0,0,.08)" : "none",
      display:"flex", alignItems:"center", gap:6,
    }}>
      {label}
      {count!==undefined && (
        <span style={{
          background: view===id?"#EFF6FF":"#F3F4F6",
          color: view===id?"#1D4ED8":"#9CA3AF",
          borderRadius:10, padding:"1px 7px", fontSize:11, fontWeight:700,
        }}>{count}</span>
      )}
    </button>
  );

  const FILTER = (id,label,c)=>(
    <button onClick={()=>setFilter(id)} style={{
      padding:"4px 12px", borderRadius:6, fontSize:12, cursor:"pointer",
      background: filter===id ? "#1D4ED8" : "#F3F4F6",
      color: filter===id ? "#fff" : "#6B7280",
      border:"none", fontWeight: filter===id ? 600 : 400,
    }}>{label} {c!==undefined&&`(${c})`}</button>
  );

  return (
    <div style={{
      minHeight:"100vh", background:"#F8FAFC",
      fontFamily:"'DM Sans',system-ui,sans-serif",
    }}>
      {/* ── Top nav ── */}
      <div style={{
        background:"#fff", borderBottom:"1px solid #E5E7EB",
        padding:"0 24px", position:"sticky", top:0, zIndex:10,
      }}>
        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          maxWidth:1400, margin:"0 auto", height:60,
        }}>
          {/* Brand */}
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{
              background:"#1D4ED8", borderRadius:10,
              width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:20,
            }}>🚚</div>
            <div>
              <div style={{fontWeight:700,fontSize:15,color:"#111827",lineHeight:1}}>SwiftDispatch</div>
              <div style={{fontSize:10,color:"#9CA3AF",letterSpacing:.5}}>DELIVERY OPERATIONS</div>
            </div>
          </div>

          {/* Delay control */}
          <div style={{display:"flex",alignItems:"center",gap:10,background:"#F9FAFB",borderRadius:10,padding:"6px 14px",border:"1px solid #E5E7EB"}}>
            <span style={{fontSize:12,color:"#6B7280"}}>🚦 Traffic delay:</span>
            <input type="range" min={0} max={20} step={1} value={delay}
              onChange={e=>setDelay(+e.target.value)}
              style={{width:90, accentColor:"#1D4ED8"}}
            />
            <span style={{fontSize:13,fontWeight:600,color:"#1D4ED8",minWidth:42}}>{delay} min</span>
          </div>

          {/* Action buttons */}
          <div style={{display:"flex",gap:8}}>
            <button onClick={addOrder} style={{
              background:"#F0FDF4", color:"#15803D", border:"1px solid #BBF7D0",
              borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:600, cursor:"pointer",
            }}>+ New Order</button>
            <button onClick={dispatchAll} style={{
              background:"#1D4ED8", color:"#fff", border:"none",
              borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:600, cursor:"pointer",
            }}>⚡ Dispatch All</button>
            <button onClick={reset} style={{
              background:"#F9FAFB", color:"#374151", border:"1px solid #E5E7EB",
              borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:600, cursor:"pointer",
            }}>↺ Reset</button>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{maxWidth:1400, margin:"0 auto", padding:"20px 24px"}}>

        {/* ── KPI row ── */}
        <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
          <KpiCard icon="⏳" label="Pending orders"    value={pending.length}   color="#F59E0B" sub="Awaiting rider assignment"/>
          <KpiCard icon="🚴" label="In transit"        value={inTransit.length} color="#3B82F6" sub="Currently being delivered"/>
          <KpiCard icon="✅" label="Delivered today"   value={delivered.length} color="#22C55E" sub="Successfully completed"/>
          <KpiCard icon="📊" label="Workload balance"  value={variance(riders).toFixed(1)} color="#8B5CF6" sub="Variance (lower = more even)"/>
          <KpiCard icon="🏍" label="Active riders"     value={`${riders.filter(r=>r.activeOrders.length>0).length}/${riders.length}`} color="#EC4899" sub="Currently on deliveries"/>
        </div>

        {/* ── Main grid ── */}
        <div style={{display:"grid", gridTemplateColumns:"1fr 340px", gap:16}}>

          {/* Left panel */}
          <div style={{display:"flex",flexDirection:"column",gap:16}}>

            {/* Map card */}
            <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:16,padding:"20px 22px",boxShadow:"0 1px 3px rgba(0,0,0,.05)"}}>
              <div style={{fontWeight:600,fontSize:15,color:"#111827",marginBottom:4}}>Live City Map</div>
              <div style={{fontSize:12,color:"#6B7280",marginBottom:14}}>Real-time positions of all riders and orders across the city grid</div>
              <GridMap riders={riders} orders={orders}/>
            </div>

            {/* Orders / Riders / Score tabs */}
            <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:16,padding:"20px 22px",boxShadow:"0 1px 3px rgba(0,0,0,.05)"}}>
              {/* Tab bar */}
              <div style={{
                display:"flex", gap:4, marginBottom:16,
                background:"#F3F4F6", borderRadius:10, padding:4, width:"fit-content",
              }}>
                {TAB("orders","📦 Orders", orders.length)}
                {TAB("riders","🏍 Riders", riders.length)}
                {TAB("scores","🔍 Analysis")}
              </div>

              {/* ── Orders tab ── */}
              {view==="orders" && (
                <div>
                  <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
                    {FILTER("all","All",orders.length)}
                    {FILTER("pending","Pending",pending.length)}
                    {FILTER("assigned","In Transit",inTransit.length)}
                    {FILTER("delivered","Delivered",delivered.length)}
                  </div>
                  {filteredOrders.length===0 ? (
                    <div style={{textAlign:"center",padding:"30px",color:"#9CA3AF",fontSize:13}}>
                      No orders in this category.
                    </div>
                  ) : (
                    <div style={{maxHeight:460,overflowY:"auto",paddingRight:4}}>
                      {filteredOrders.map(o=>(
                        <OrderRow
                          key={o.id} order={o} riders={riders} delay={delay}
                          selected={o.id===selId}
                          onSelect={setSelId}
                          onDispatch={dispatchOne}
                          onComplete={markDelivered}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Riders tab ── */}
              {view==="riders" && (
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
                  {riders.map(r=><RiderCard key={r.id} rider={r}/>)}
                </div>
              )}

              {/* ── Score analysis tab ── */}
              {view==="scores" && (
                <div>
                  <div style={{marginBottom:14}}>
                    <label style={{fontSize:12,color:"#6B7280",fontWeight:500}}>Select order to analyze:</label>
                    <select
                      value={selId}
                      onChange={e=>setSelId(e.target.value)}
                      style={{
                        marginLeft:10, padding:"6px 10px", borderRadius:8,
                        border:"1px solid #E5E7EB", fontSize:12, background:"#fff",
                        color:"#374151",
                      }}
                    >
                      {orders.map(o=>(
                        <option key={o.id} value={o.id}>
                          {o.id} — {o.area} ({o.priority})
                        </option>
                      ))}
                    </select>
                  </div>
                  <ScorePanel order={selectedOrder} riders={riders} delay={delay}/>
                </div>
              )}
            </div>
          </div>

          {/* Right sidebar */}
          <div style={{display:"flex",flexDirection:"column",gap:16}}>

            {/* Quick actions */}
            <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:16,padding:"18px 20px",boxShadow:"0 1px 3px rgba(0,0,0,.05)"}}>
              <div style={{fontWeight:600,fontSize:14,color:"#111827",marginBottom:12}}>Quick Actions</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {pending.slice(0,3).map(o=>(
                  <div key={o.id} style={{
                    display:"flex",alignItems:"center",justifyContent:"space-between",
                    background:"#FFF7ED",border:"1px solid #FED7AA",
                    borderRadius:10,padding:"10px 12px",
                  }}>
                    <div>
                      <div style={{fontSize:12,fontWeight:600,color:"#111827"}}>{o.id}</div>
                      <div style={{fontSize:11,color:"#9CA3AF"}}>{o.area} · {o.priority}</div>
                    </div>
                    <button onClick={()=>dispatchOne(o.id)} style={{
                      background:"#1D4ED8",color:"#fff",border:"none",
                      borderRadius:7,padding:"5px 11px",fontSize:11,fontWeight:600,cursor:"pointer",
                    }}>Assign</button>
                  </div>
                ))}
                {pending.length===0 && (
                  <div style={{textAlign:"center",color:"#9CA3AF",fontSize:12,padding:"12px 0"}}>
                    All orders dispatched! 🎉
                  </div>
                )}
              </div>
            </div>

            {/* Activity log */}
            <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:16,padding:"18px 20px",boxShadow:"0 1px 3px rgba(0,0,0,.05)",flex:1}}>
              <div style={{fontWeight:600,fontSize:14,color:"#111827",marginBottom:12}}>Activity Feed</div>
              <ActivityLog log={log}/>
            </div>

            {/* System constraints (from constraints.csv) */}
            <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:16,padding:"18px 20px",boxShadow:"0 1px 3px rgba(0,0,0,.05)"}}>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:12}}>
                <span style={{fontSize:16}}>⚙️</span>
                <div style={{fontWeight:600,fontSize:14,color:"#111827"}}>System Constraints</div>
                <span style={{marginLeft:"auto",fontSize:10,background:"#F0FDF4",color:"#15803D",border:"1px solid #BBF7D0",borderRadius:6,padding:"2px 7px",fontWeight:600}}>Live Config</span>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {[
                  { label:"Max orders per rider",      value:`${MAX_ORDERS_PER_RIDER} orders`,         icon:"🏍", desc:"Hard cap on simultaneous deliveries" },
                  { label:"Default SLA window",        value:`${DEFAULT_SLA_MINUTES} min`,             icon:"⏱", desc:"Target delivery time for all orders" },
                  { label:"Decision latency target",   value:`${DECISION_LATENCY_TARGET} sec`,         icon:"⚡", desc:"Max time to auto-assign a rider" },
                  { label:"High priority weight",      value:"1.5×",                                   icon:"🔥", desc:"Urgent & high orders get 1.5× boost" },
                  { label:"Standard priority weight",  value:"1.0×",                                   icon:"📦", desc:"Normal orders, no adjustment" },
                  { label:"Low priority weight",       value:"0.8×",                                   icon:"🐢", desc:"Low orders deprioritised in queue" },
                ].map(item=>(
                  <div key={item.label} style={{
                    display:"flex",alignItems:"center",gap:10,
                    background:"#F8FAFC",borderRadius:9,padding:"9px 12px",
                    border:"1px solid #F1F5F9",
                  }}>
                    <span style={{fontSize:16,flexShrink:0}}>{item.icon}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11,color:"#6B7280"}}>{item.label}</div>
                      <div style={{fontSize:10,color:"#9CA3AF",marginTop:1}}>{item.desc}</div>
                    </div>
                    <span style={{fontSize:13,fontWeight:700,color:"#1D4ED8",flexShrink:0}}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Scoring guide */}
            <div style={{background:"#1E293B",border:"none",borderRadius:16,padding:"18px 20px"}}>
              <div style={{fontWeight:600,fontSize:13,color:"#F1F5F9",marginBottom:10}}>How Rider Scoring Works</div>
              <div style={{fontSize:11,color:"#94A3B8",lineHeight:1.7}}>
                The system picks the <b style={{color:"#60A5FA"}}>lowest score</b> as the best rider. Each factor is weighted:
              </div>
              <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:5}}>
                {[
                  {emoji:"📍",label:"Distance",   w:"+40%",  desc:"How far the rider is from the pickup"},
                  {emoji:"⏰",label:"SLA risk",    w:"+35%",  desc:"Penalty if ETA exceeds the SLA window"},
                  {emoji:"⚖️",label:"Fairness",   w:"+20%",  desc:"Balances work evenly across all riders"},
                  {emoji:"⭐",label:"Rating",      w:"−20%",  desc:"High-rated riders get a score reduction"},
                  {emoji:"🔥",label:"Priority",    w:"−30%",  desc:"Boost scaled by priority weight (CSV)"},
                ].map(item=>(
                  <div key={item.label} style={{display:"flex",alignItems:"flex-start",gap:8,background:"#0F172A",borderRadius:8,padding:"7px 10px"}}>
                    <span style={{fontSize:14,flexShrink:0}}>{item.emoji}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",justifyContent:"space-between"}}>
                        <span style={{fontSize:11,color:"#E2E8F0",fontWeight:500}}>{item.label}</span>
                        <span style={{fontSize:11,color:"#60A5FA",fontWeight:700}}>{item.w}</span>
                      </div>
                      <div style={{fontSize:10,color:"#64748B",marginTop:1}}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
