// Browser-safe screening of a concrete announcement. This does not verify a launch.
export const LAUNCH_VERSION=1;
const product=/\b(?:business|corporate|SME|company)\s+(?:(?:bank|banking|multi.?currency|payment|current|euro|IBAN)\s+){0,2}(?:accounts?|banking|bank)\b|\b(?:neobank|multi.?currency accounts?|IBAN accounts?)\b|бизнес[ -]?сч[её]т|необанк|geschäftskonto|compte professionnel/iu;
const editorial=/^(?:how|why|what|the future|a guide|guide|opinion|analysis|explained|understanding|trends|top\s+\d|best|weekly|round.?up|this week|the rise|the evolution)\b|\b(?:industry trends|thought leadership|opinion piece|weekly roundup)\b|^(?:как|почему|обзор|мнение|будущее|топ|рейтинг|руководство)\b/iu;
const generic=/^(?:we|our|i|they|banks?|banking|fintechs?|startups?|companies|business(?:es)?|corporate|new|europe|european|the industry|this|it|launch|introducing|today|now|welcome)$/iu;
function entity(value){const name=value.replace(/^(?:breaking:?\s*|exclusive:?\s*|fintech\s+(?:startup|company)\s+)/iu,'').replace(/[\s:–—-]+$/u,'').trim();return name.length>=2&&name.length<=100&&!generic.test(name)&&name.split(/\s+/).length<=8?name:null;}
export function assessLaunch(entry){
 const title=String(entry.title??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
 const snippet=String(entry.snippet??entry.description??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
 const text=`${title}. ${snippet}`;
 const result=(kind,company=null,evidence='')=>({version:LAUNCH_VERSION,kind,company,evidence:evidence.slice(0,900),eventType:kind==='live_launch'?(/\b(?:new neobank|new digital bank|new bank)\b|новый необанк/iu.test(text)?'provider_launch':'business_account_launch'):null});
 if(editorial.test(title))return result('commentary');
 const action='(?:launch(?:es|ed)?|introduc(?:es|ed)|unveil(?:s|ed)?|debut(?:s|ed)?|roll(?:s|ed)? out|goes live|opens?|expands?|запустил[аи]?|запускает|представил[аи]?|открыл[аи]?)';
 const match=title.match(new RegExp(`^(.{2,100}?)\\s+(?:(has|have|is|will|plans to|to)\\s+)?(${action})\\b(.{0,180})`,'iu'));
 let company=match?entity(match[1]):null,statement=match?`${title}. ${snippet.slice(0,500)}`:'';
 if(match&&/\b(?:report|survey|study|webinar|podcast|conference|blog|AI assistant|AI agent|redesign)\b|исследован|вебинар|подкаст/iu.test(match[4]))return result('other_event',company,title);
 if(!company){
  const body=snippet.match(new RegExp(`(?:^|[.!?]\\s+)([\\p{L}][\\p{L}0-9&.'-]*(?: [\\p{L}][\\p{L}0-9&.'-]*){0,4})\\s+(?:(?:has|have|will|plans to)\\s+)?${action}\\b[^.!?]{0,260}`,'iu'));
  if(body&&entity(body[1])){company=entity(body[1]);statement=body[0];}
 }
 if(!company){const introducing=title.match(/^(?:introducing|meet|welcome to)\s+([\p{L}0-9&.'-]+)(?:\s*[:–—-]|$)/iu);if(introducing){company=entity(introducing[1]);statement=`${title}. ${snippet.slice(0,500)}`;}}
 if(!company||!product.test(statement))return result('not_launch');
 if(/\b(?:plans? to|planning to|will launch|to launch|coming soon|waitlist|pre.?register|not yet available)\b|планиру|скоро|лист ожидания/iu.test(statement))return result('planned_launch',company,statement);
 if(/\b(?:launched in \d{4}|launched \d+ years? ago|since 20[0-2]\d)\b/iu.test(statement)&&!match)return result('not_launch');
 return result('live_launch',company,statement);
}
