const page = require('../../utils/page')
const content = require('../../utils/privacy-content')

page({
  data: {
    sections: content.SECTIONS,
    lastUpdated: content.LAST_UPDATED,
    contactLabel: content.CONTACT_EMAIL || '待公示（上线前补齐）'
  }
})
