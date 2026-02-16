import{DynamoDBClient as b}from"@aws-sdk/client-dynamodb";import{DynamoDBDocumentClient as x,QueryCommand as p,ScanCommand as E}from"@aws-sdk/lib-dynamodb";import{SESv2Client as S,SendEmailCommand as C}from"@aws-sdk/client-sesv2";var D=process.env.ATTENDANCE_TABLE,B=process.env.SHIFTS_TABLE,f=process.env.STAFF_CLINIC_INFO_TABLE,u=process.env.APP_NAME||"TodaysDentalInsights",k=process.env.FROM_EMAIL||"no-reply@todaysdentalinsights.com",I=process.env.SES_REGION||"us-east-1",g=x.from(new b({})),T=new S({region:I});function w(){let t=new Date,e=new Date(t);e.setDate(e.getDate()-(e.getDay()+6)%7),e.setHours(0,0,0,0);let o=new Date(e);return o.setDate(o.getDate()-7),{startDate:o.toISOString().split("T")[0],endDate:e.toISOString().split("T")[0]}}async function N(){let t=await g.send(new E({TableName:f,ProjectionExpression:"clinicId"})),e=new Set;for(let o of t.Items||[])o.clinicId&&e.add(o.clinicId);return Array.from(e)}async function v(t,e,o){let i=(await g.send(new p({TableName:D,IndexName:"byDate",KeyConditionExpression:"clinicId = :cid AND #d BETWEEN :start AND :end",ExpressionAttributeNames:{"#d":"date"},ExpressionAttributeValues:{":cid":t,":start":e,":end":o}}))).Items||[],s=i.filter(n=>n.type==="checkin"),d=i.filter(n=>n.type==="checkout"),l=s.filter(n=>n.isLate),h=new Set(i.map(n=>n.userId)),m=s.flatMap(n=>n.anomalies||[]),c={};m.forEach(n=>{c[n]=(c[n]||0)+1});let y=Object.entries(c).sort((n,r)=>r[1]-n[1]).slice(0,5).map(([n,r])=>`${n} (${r})`),A=l.length>0?Math.round(l.reduce((n,r)=>n+(r.lateMinutes||0),0)/l.length):0;return{clinicId:t,totalCheckins:s.length,totalCheckouts:d.length,totalLateArrivals:l.length,avgLateMinutes:A,uniqueStaff:h.size,anomalyCount:m.length,topAnomalies:y}}async function L(t){return((await g.send(new p({TableName:f,IndexName:"byClinic",KeyConditionExpression:"clinicId = :cid",FilterExpression:"contains(#r, :admin)",ExpressionAttributeNames:{"#r":"role"},ExpressionAttributeValues:{":cid":t,":admin":"admin"},ProjectionExpression:"email"}))).Items||[]).map(o=>o.email).filter(Boolean)}function $(t,e,o){return`<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f7;padding:20px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px 40px;background:linear-gradient(135deg,#1d1d1f,#2d2d2f);">
          <h1 style="margin:0;color:#fff;font-size:22px;">\u{1F4CA} Weekly Attendance Digest</h1>
          <p style="margin:8px 0 0;color:#a1a1a6;font-size:14px;">${e} \u2014 ${o}</p>
        </td></tr>
        <tr><td style="padding:24px 40px;">
          <table width="100%" cellpadding="8" cellspacing="0" style="border:1px solid #e5e5e7;border-radius:8px;">
            <tr style="background:#f5f5f7;">
              <td style="font-weight:600;color:#1d1d1f;">Metric</td>
              <td style="font-weight:600;color:#1d1d1f;text-align:right;">Value</td>
            </tr>
            <tr><td>Total Check-ins</td><td style="text-align:right;">${t.totalCheckins}</td></tr>
            <tr><td>Total Check-outs</td><td style="text-align:right;">${t.totalCheckouts}</td></tr>
            <tr><td>Unique Staff</td><td style="text-align:right;">${t.uniqueStaff}</td></tr>
            <tr><td>Late Arrivals</td><td style="text-align:right;color:${t.totalLateArrivals>0?"#ff3b30":"#34c759"};">${t.totalLateArrivals}</td></tr>
            <tr><td>Avg Late Minutes</td><td style="text-align:right;">${t.avgLateMinutes} min</td></tr>
            <tr><td>Anomalies</td><td style="text-align:right;">${t.anomalyCount}</td></tr>
          </table>
          ${t.topAnomalies.length>0?`
          <div style="margin-top:16px;padding:12px;background:#fff3cd;border-radius:8px;">
            <p style="margin:0;font-weight:600;color:#856404;">\u26A0\uFE0F Top Anomalies</p>
            <p style="margin:8px 0 0;color:#856404;font-size:14px;">${t.topAnomalies.join(", ")}</p>
          </div>`:""}
        </td></tr>
        <tr><td style="padding:16px 40px;border-top:1px solid #e5e5e7;text-align:center;">
          <p style="margin:0;color:#86868b;font-size:12px;">Automated report from ${u}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`}async function P(){console.log("Weekly attendance digest triggered");let{startDate:t,endDate:e}=w(),o=await N();for(let a of o)try{let i=await v(a,t,e);if(i.totalCheckins===0&&i.totalCheckouts===0)continue;let s=await L(a);if(s.length===0)continue;let d=$(i,t,e);await T.send(new C({FromEmailAddress:k,Destination:{ToAddresses:s},Content:{Simple:{Subject:{Data:`${u} \u2014 Attendance Digest (${t} to ${e})`,Charset:"UTF-8"},Body:{Html:{Data:d,Charset:"UTF-8"}}}}})),console.log(`Sent digest for ${a} to ${s.length} admins`)}catch(i){console.error(`Failed to send digest for ${a}:`,i)}}export{P as handler};
