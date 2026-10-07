import {Parser} from 'htmlparser2';

// Parse data only: no DOM rendering, scripts, images, links or remote requests.
export function mailHtmlText(html:string) {
  const chunks:string[]=[],hidden:boolean[]=[];
  const blocks=new Set(['p','div','li','br','tr','td','table','h1','h2','h3','h4','blockquote','section']);
  const parser=new Parser({
    onopentag(name,attrs) {
      const skip=!!hidden.at(-1) || ['head','script','style','template','noscript','svg'].includes(name) || 'hidden' in attrs || attrs['aria-hidden']==='true' || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style || '');
      hidden.push(skip);if(!skip && blocks.has(name))chunks.push('\n');
    },
    ontext(text){if(!hidden.at(-1))chunks.push(text);},
    onclosetag(name){const skip=hidden.pop();if(!skip && blocks.has(name))chunks.push('\n');},
  },{decodeEntities:true});
  parser.end(html.slice(0,1048576));
  return chunks.join('').replace(/[\t \u00a0]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
