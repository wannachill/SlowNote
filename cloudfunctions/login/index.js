// 云函数：login —— 登录并确保用户写入 users 集合
// 首次进入自动建档，之后更新最近登录时间；返回 openid 供前端建立登录态
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  const { OPENID, APPID, UNIONID } = cloud.getWXContext()
  if (!OPENID) return { code: 401, message: 'UNAUTHORIZED' }

  // 查询用户，不存在则自动建档
  const users = await db.collection('users').where({ openid: OPENID }).get()
  let user
  if (users.data.length) {
    user = users.data[0]
  } else {
    const add = await db.collection('users').add({
      data: {
        openid: OPENID,
        nickname: '',
        created_at: db.serverDate(),
        last_login_at: db.serverDate()
      }
    })
    user = { _id: add._id, openid: OPENID, nickname: '' }
  }

  // 更新最近登录时间
  await db.collection('users').where({ openid: OPENID }).update({
    data: { last_login_at: db.serverDate() }
  })

  return {
    code: 0,
    openid: OPENID,
    appid: APPID,
    unionid: UNIONID || '',
    nickname: user.nickname || ''
  }
}
