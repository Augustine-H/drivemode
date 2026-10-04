export function isMediaQuestion(text: string) {
  const compact = text.replace(/\s+/g, "");
  return (
    /사진|이미지|그림|셀카|영상|동영상|비디오/.test(compact) &&
    /설명|묘사|분석|해석|내용|무슨|어떤색|왜|누구|뭐야|어때|보이는|몇마리|몇명|알려/.test(
      compact,
    ) &&
    !/새로|다시만들|다시그려/.test(compact)
  );
}

export function wantsVideo(text: string) {
  if (isMediaQuestion(text)) return false;
  const compact = text.replace(/\s+/g, "");
  if (/설명|묘사|분석|해석|알려|보낸적|안보|안떠|안뜨|어디|이상|깨져|안나/.test(compact))
    return false;
  if (
    /(영상|동영상|비디오|클립)/.test(compact) &&
    /(만들|찍어|생성|보내|보여|해봐|해줘|하나)/.test(compact)
  )
    return true;
  return /(영상|동영상|비디오)(로|을|를)?$/.test(compact) && compact.length > 4;
}

export function videoSeconds(text: string) {
  const found = text.match(/(\d+)\s*초/);
  const seconds = found ? Number(found[1]) : 5;
  return Math.min(8, Math.max(2, seconds || 5));
}

export function videoPrompt(text: string, history: { role: string; content: string }[]) {
  const cleaned = text
    .replace(/\d+\s*초(짜리)?/g, " ")
    .replace(/짧은 영상|동영상|비디오|클립|영상/g, " ")
    .replace(
      /베이스로|기반으로|만들어\s*봐|만들어봐|만들어\s*줘|만들어줘|해\s*봐|해봐|해\s*줘|하나/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!isVagueSubject(cleaned) && cleaned.length > 1) return cleaned.slice(0, 400);
  for (let i = history.length - 1; i >= 0; i--) {
    const content = history[i].content.replace(/\s+/g, " ").trim();
    if (!content || isAside(content) || wantsVideo(content) || wantsImage(content)) continue;
    return content.slice(0, 400);
  }
  return (cleaned || "짧은 장면이 살짝 움직인다").slice(0, 400);
}

export function wantsImage(text: string) {
  if (isMediaQuestion(text)) return false;
  const compact = text.replace(/\s+/g, "");
  if (/설명|묘사|분석|해석|알려|보낸적|안보|안떠|안뜨|어디|이상|깨져|안나|없대|없어/.test(compact))
    return false;
  if (/그려(줘|줄|봐|라|주|요)/.test(compact)) return true;
  if (
    /(셀카|그림|이미지|사진|일러스트).{0,8}(만들어|그려|생성해|보내|보여|찍어|달라)/.test(compact)
  ) {
    return !/누구|언제|왜|뭐야|맞아/.test(compact);
  }
  if (/(셀카|사진|그림|이미지).{0,4}(줘|봐)$/.test(compact)) return true;
  if (/(이미지|그림|사진|일러스트|셀카)(로|을|를)?$/.test(compact) && compact.length > 4)
    return true;
  return /\b(draw|illustrat\w*|generate)\b.{0,24}\b(image|picture|photo)\b/i.test(text);
}

export function imagePrompt(text: string, history: { role: string; content: string }[]) {
  const cleaned = text
    .replace(/^[가-힣]{1,8}[야아]\s+/, " ")
    .replace(
      /그려\s*줘|그려줘|그려\s*줄래|그려\s*주라|그려봐|그려\s*봐|그려라|그림으로|이미지로|이미지\s*생성|만들어\s*줘|만들어줘|보내\s*줘|보내줘|보내\s*봐|보내봐|보여\s*줘|보여줘|보여\s*봐|보여봐|찍어\s*줘|찍어줘|찍어\s*봐|찍어봐|찍어/g,
      " ",
    )
    .replace(/(이미지|그림|일러스트)(로|을|를)?$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!isVagueSubject(cleaned)) return cleaned.slice(0, 400);
  for (let i = history.length - 1; i >= 0; i--) {
    const content = history[i].content.replace(/\s+/g, " ").trim();
    if (!content || isAside(content)) continue;
    if (history[i].role === "user" && wantsImage(content)) continue;
    return content.slice(0, 400);
  }
  return (cleaned || text).slice(0, 400);
}

function isVagueSubject(cleaned: string) {
  const compact = cleaned.replace(/\s+/g, "");
  if (!compact) return true;
  return /^(그거|이거|저거|방금|방금말한(거|것|장면)?|그것|어떤(이미지|그림|사진)?|이미지|그림|사진|하나|장면)$/.test(
    compact,
  );
}

function isAside(content: string) {
  return /이미지를 만들 수 없|글로만 대화|그림을 만들었|이미지를 만들었|화면에서 볼 수|화면에서 바로/.test(
    content,
  );
}
