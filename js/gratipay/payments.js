/* Bank Account and Credit Card forms
 *
 * These two forms share some common wiring under the Gratipay.payments
 * namespace, and each has unique code under the Gratipay.payments.{cc,ba}
 * namespaces. Each form gets its own page so we only instantiate one of these
 * at a time.
 *
 */

Gratipay.payments = {};


// Common code
// ===========

Gratipay.payments.init = function() {
    $('#delete').submit(Gratipay.payments.deleteRoute);
}

Gratipay.payments.lazyLoad = function(script_url) {
    jQuery.getScript(script_url, function() {
        $('input[type!="hidden"]').eq(0).focus();
    }).fail(Gratipay.error);
}

Gratipay.payments.deleteRoute = function(e) {
    e.stopPropagation();
    e.preventDefault();

    var $this = $(this);
    var confirm_msg = $this.data('confirm');
    if (confirm_msg && !confirm(confirm_msg)) {
        return false;
    }
    jQuery.ajax(
        { url: "/~" + Gratipay.username + "/routes/delete.json"
        , data: {network: $this.data('network'), address: $this.data('address')}
        , type: "POST"
        , success: function() { window.location.reload(); }
        , error: Gratipay.error
         }
    );
    return false;
};

Gratipay.payments.onSuccess = function(data) {
    $('button#save').prop('disabled', false);
    window.location.reload();
};

Gratipay.payments.associate = function (network, address) {
    jQuery.ajax({
        url: "associate.json",
        type: "POST",
        data: {network: network, address: address},
        dataType: "json",
        success: Gratipay.payments.onSuccess,
        error: [
            Gratipay.error,
            function() { $('button#save').prop('disabled', false); },
        ],
    });
};


// Bank Accounts
// =============

Gratipay.payments.ba = {};

Gratipay.payments.ba.init = function() {
    Gratipay.payments.init();

    // Lazily depend on Balanced.
    Gratipay.payments.lazyLoad("https://js.balancedpayments.com/1.1/balanced.min.js")

    $('form#bank-account').submit(Gratipay.payments.ba.submit);
};

Gratipay.payments.ba.submit = function (e) {
    e.preventDefault();

    $('button#save').prop('disabled', true);
    Gratipay.forms.clearInvalid($(this));

    var bankAccount = {
        name: $('#account_name').val(),
        account_number: $('#account_number').val(),
        account_type: $('#account_type').val(),
        routing_number: $('#routing_number').val()
    };

    // Validate routing number.
    if (bankAccount.routing_number) {
        if (!balanced.bankAccount.validateRoutingNumber(bankAccount.routing_number)) {
            Gratipay.forms.setInvalid($('#routing_number'));
            Gratipay.forms.focusInvalid($(this));
            $('button#save').prop('disabled', false);
            return false
        }
    }

    // Okay, send the data to Balanced.
    balanced.bankAccount.create(bankAccount, function (response) {
        if (response.status_code !== 201) {
            return Gratipay.payments.ba.onError(response);
        }

        /* The request to tokenize the thing succeeded. Now we need to associate it
         * to the Customer on Balanced and to the participant in our DB.
         */
        Gratipay.payments.associate('balanced-ba', response.bank_accounts[0].href);
    });
};

Gratipay.payments.ba.onError = function(response) {
    $('button#save').prop('disabled', false);
    var msg = response.status_code + ": " +
        $.map(response.errors, function(obj) { return obj.description }).join(', ');
    Gratipay.notification(msg, 'error', -1);
    return msg;
};


// Credit Cards
// ============

Gratipay.payments.cc = {};

Gratipay.payments.cc.init = function() {
    Gratipay.payments.init();

    // Lazily depend on Braintree.
    Gratipay.payments.lazyLoad("https://js.braintreegateway.com/v2/braintree.js")

    $('form#credit-card').submit(Gratipay.payments.cc.submit);
    Gratipay.payments.cc.formatInputs(
        $('#card_number'),
        $('#expiration_month'),
        $('#expiration_year'),
        $('#cvv')
    );
};


/* Most of the following code is taken from https://github.com/wangjohn/creditly */

Gratipay.payments.cc.formatInputs = function (cardNumberInput, expirationMonthInput, expirationYearInput, cvvInput) {
    function getInputValue(e, element) {
        var inputValue = element.val().trim();
        inputValue = inputValue + String.fromCharCode(e.which);
        return inputValue.replace(/[^\d]/g, "");
    }

    function isEscapedKeyStroke(e) {
        // Key event is for a browser shortcut
        if (e.metaKey || e.ctrlKey) return true;

        // If keycode is a space
        if (e.which === 32) return false;

        // If keycode is a special char (WebKit)
        if (e.which === 0) return true;

        // If char is a special char (Firefox)
        if (e.which < 33) return true;

        return false;
    }

    function isNumberEvent(e) {
        return (/^\d+$/.test(String.fromCharCode(e.which)));
    }

    function onlyAllowNumeric(e, maximumLength, element) {
        e.preventDefault();
        // Ensure that it is a number and stop the keypress
        if (!isNumberEvent(e)) {
            return false;
        }
        return true;
    }

    var isAmericanExpress = function(number) {
        return number.match("^(34|37)");
    };

    function shouldProcessInput(e, maximumLength, element) {
        var target = e.currentTarget;
        if (getInputValue(e, element).length > maximumLength) {
          e.preventDefault();
          return false;
        }
        if ((target.selectionStart !== target.value.length)) {
          return false;
        }
        return (!isEscapedKeyStroke(e)) && onlyAllowNumeric(e, maximumLength, element);
    }

    function addSpaces(number, spaces) {
      var parts = []
      var j = 0;
      for (var i=0; i<spaces.length; i++) {
        if (number.length > spaces[i]) {
          parts.push(number.slice(j, spaces[i]));
          j = spaces[i];
        } else {
          if (i < spaces.length) {
            parts.push(number.slice(j, spaces[i]));
          } else {
            parts.push(number.slice(j));
          }
          break;
        }
      }

      if (parts.length > 0) {
        return parts.join(" ");
      } else {
        return number;
      }
    }

    var americanExpressSpaces = [4, 10, 15];
    var defaultSpaces = [4, 8, 12, 16];

    cardNumberInput.on("keypress", function(e) {
        var number = getInputValue(e, cardNumberInput);
        var isAmericanExpressCard = isAmericanExpress(number);
        var maximumLength = (isAmericanExpressCard ? 15 : 16);
        if (shouldProcessInput(e, maximumLength, cardNumberInput)) {
            var newInput;
            newInput = isAmericanExpressCard ? addSpaces(number, americanExpressSpaces) : addSpaces(number, defaultSpaces);
            cardNumberInput.val(newInput);
        }
    });

    expirationMonthInput.on("keypress", function(e) {
        var maximumLength = 2;
        if (shouldProcessInput(e, maximumLength, expirationMonthInput)) {
            var newInput = getInputValue(e, expirationMonthInput);
            if (newInput < 13) {
                expirationMonthInput.val(newInput);
            } else {
                e.preventDefault();
            }
        }
    });

    expirationYearInput.on("keypress", function(e) {
        var maximumLength = 2;
        if (shouldProcessInput(e, maximumLength, expirationYearInput)) {
            var newInput = getInputValue(e, expirationYearInput);
            expirationYearInput.val(newInput);
        }
    });

    cvvInput.on("keypress", function(e) {
        var number = getInputValue(e, cardNumberInput);
        var isAmericanExpressCard = isAmericanExpress(number);
        var maximumLength = (isAmericanExpressCard ? 4 : 3);
        if (shouldProcessInput(e, maximumLength, cvvInput)) {
            var newInput = getInputValue(e, cvvInput);
            cvvInput.val(newInput);
        }
    });
}

Gratipay.payments.cc.submit = function(e) {

    e.stopPropagation();
    e.preventDefault();
    $('button#save').prop('disabled', true);
    Gratipay.forms.clearInvalid($(this));

    // Adapt our form lingo to braintree nomenclature.

    function val(field) {
        return $('form#credit-card #'+field).val();
    }

    var credit_card = {};

    credit_card.number = val('card_number').replace(/[^\d]/g, '');
    credit_card.cvv = val('cvv');
    credit_card.cardholderName = val('name');
    credit_card.billingAddress = { 'postalCode': val('zip') };
    credit_card.expirationMonth = val('expiration_month');
    var year = val('expiration_year');
    credit_card.expirationYear = year.length == 2 ? '20' + year : year;

    // TODO: Client Side validation

    var client = new braintree.api.Client({clientToken: val('braintree_token')});

    client.tokenizeCard(credit_card, function (err, nonce) {
        if (err) {
            Gratipay.notification(err, 'error')
        } else {
            Gratipay.payments.associate('braintree-cc', nonce);
        }
    });

    return false;
};

// PayPal
// ======

Gratipay.payments.pp = {};

Gratipay.payments.pp.init = function () {
    Gratipay.payments.init();
    $('form#paypal').submit(Gratipay.payments.pp.submit);
}

Gratipay.payments.pp.submit = function (e) {
    e.stopPropagation();
    e.preventDefault();
    $('button#save').prop('disabled', true);
    var paypal_email = $('form#paypal #email').val();

    Gratipay.payments.associate('paypal', paypal_email);
}
