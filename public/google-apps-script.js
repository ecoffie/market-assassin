var API_URL = 'https://assassin.govcongiants.org/api/customer-report';
var API_KEY = '';

function onFormSubmit(e) {
  var responses = e.namedValues;

  var email = responses['Email Address'] ? responses['Email Address'][0] : '';
  var companyName = responses['Company Name'] ? responses['Company Name'][0] : '';
  var businessType = responses['Business Type'] ? responses['Business Type'][0] : 'Small Business';
  var naicsCode = responses['NAICS Code'] ? responses['NAICS Code'][0] : '';
  var zipCode = responses['ZIP Code'] ? responses['ZIP Code'][0] : '';
  var veteranStatus = responses['Are you Veteran-Owned?'] ? responses['Are you Veteran-Owned?'][0] : 'No';
  var serviceDisabled = responses['Are you Service-Disabled Veteran-Owned?'] ? responses['Are you Service-Disabled Veteran-Owned?'][0] : 'No';

  if (!email) {
    console.error('No email');
    return;
  }

  var formData = {
    email: email,
    companyName: companyName,
    businessType: businessType,
    naicsCode: naicsCode,
    zipCode: zipCode,
    veteranStatus: veteranStatus,
    serviceDisabled: serviceDisabled,
    apiKey: API_KEY
  };

  var options = {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify(formData),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(API_URL, options);
  var result = JSON.parse(response.getContentText());

  if (result.success && result.reportHtml) {
    sendReportEmail(email, companyName, result.reportHtml);
  } else {
    sendErrorEmail(email, companyName);
  }
}

function sendReportEmail(email, companyName, htmlContent) {
  GmailApp.sendEmail(email, 'Your Federal Market Assassin Report | GovCon Giants', 'View in HTML', {
    htmlBody: htmlContent,
    name: 'GovCon Giants'
  });
}

function sendErrorEmail(email, companyName) {
  GmailApp.sendEmail(email, 'Your Report | GovCon Giants', 'We are working on your report and will send it shortly. - GovCon Giants', {
    name: 'GovCon Giants'
  });
}

function setupTrigger() {
  var form = FormApp.getActiveForm();
  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
}
