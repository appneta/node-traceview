const path = require('path')
const fs = require('fs')

let ajax = fs.readFileSync(
	path.join(__dirname, '../rum-templates/ajax-header.tmpl')
)
let no_ajax = fs.readFileSync(
	path.join(__dirname, '../rum-templates/no-ajax-header.tmpl')
)
let footer = fs.readFileSync(
	path.join(__dirname, '../rum-templates/footer.tmpl')
)

function tmpl (text, data) {
	return text.toString().replace(/#{([^{}]*)}/g, function (a, expression) {
		let fn = new Function('data', `with (data) { return ${expression} }`)
		return fn(data)
	})
}

function header (rumId, traceId) {
	return tmpl(no_ajax, { rumId, traceId })
}

function ajaxHeader (rumId, traceId) {
	return tmpl(ajax, { rumId, traceId })
}

exports.header = header
exports.ajaxHeader = ajaxHeader
exports.footer = function () {
	return footer.toString()
}

exports.inject = function (data, rumId, traceId, xhr) {
	let header = xhr ? exports.ajaxHeader : exports.header
	data.rumHeader = header(rumId, traceId)
	data.rumFooter = footer.toString()
}
