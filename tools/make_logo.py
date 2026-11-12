# 生成「一迈一记」可爱宝宝头 logo（v2）：
# 浅蓝圆底 + 深蓝宝宝头剪影（圆脸 + 双耳 + 头顶小揪揪呆毛），脸上镂空眼睛与微笑
# 单一蓝色主题，与小程序主题色一致
from PIL import Image, ImageDraw

SIZE = 240
bg_round = (214, 232, 247, 255)   # 浅蓝圆底 #D6E8F7
ink = (46, 109, 166, 255)         # 深蓝剪影 #2E6DA6

img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆底
d.ellipse((8, 8, SIZE - 8, SIZE - 8), fill=bg_round)

# 宝宝头剪影（同色合并）：圆脸 + 双耳 + 头顶小揪揪
d.ellipse((60, 70, 180, 196), fill=ink)       # 圆脸（中心120,133）
d.ellipse((108, 46, 132, 78), fill=ink)       # 头顶小揪揪（呆毛）
d.ellipse((42, 112, 74, 148), fill=ink)       # 左耳
d.ellipse((166, 112, 198, 148), fill=ink)     # 右耳

# 五官镂空（用圆底颜色在剪影上挖出）：圆眼 + 微笑弧
d.ellipse((94, 118, 108, 132), fill=bg_round)   # 左眼
d.ellipse((132, 118, 146, 132), fill=bg_round)  # 右眼
d.arc((98, 130, 142, 158), start=20, end=160, fill=bg_round, width=7)  # 微笑

out = r'D:\JAVA\JavaCode\VibeCoding\SlowNote\miniprogram\images\logo.png'
img.save(out)
print('saved:', out)
