// Public administrative access is an explicit deployment option, never default.
export function cloudAccess(env=process.env){
 if(env.PLAY_SCOUT_PUBLIC_ADMIN==='true')return {password:'',viewerPassword:''};
 if(!env.APP_PASSWORD||env.APP_PASSWORD.length<12)throw Error('Cloud startup requires APP_PASSWORD with at least 12 characters.');
 if(env.VIEW_PASSWORD&&(env.VIEW_PASSWORD.length<12||env.VIEW_PASSWORD===env.APP_PASSWORD))throw Error('VIEW_PASSWORD must be different and at least 12 characters.');
 return {password:env.APP_PASSWORD,viewerPassword:env.VIEW_PASSWORD||''};
}
