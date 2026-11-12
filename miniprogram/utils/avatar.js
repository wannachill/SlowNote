// 宝宝头像解析：上传照片（cloud fileID）优先；否则按性别用内置默认（男宝小揪揪/女宝蝴蝶结，未填性别默认男宝）
function avatarSrc(baby) {
  const avatar = (baby && baby.avatar) || ''
  if (avatar && avatar !== 'boy' && avatar !== 'girl') return avatar
  if (baby && baby.gender === 'female') return '/images/girl.png'
  return '/images/boy.png'
}
module.exports = { avatarSrc }
