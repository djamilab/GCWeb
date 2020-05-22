/**
 * @title WET-BOEW gc invitation manager plugin
 * @license wet-boew.github.io/wet-boew/Licence-en.html / wet-boew.github.io/wet-boew/Licence-fr.html
 * @author Djamila Bouzid
*/


( function( $, window, wb ) {
"use strict";


	/*
	 * Variable and function definitions.
	 * These are global to the plugin - meaning that they will be initialized once per page,
	 * not once per instance of plugin on the page. So, this is a good place to define
	 * variables that are common to all instances of the plugin on a page.
	 */
var componentName = "wb-im-popup",		// Define the name of the plugin and the class name to use in order to initiate it
	selector = "." + componentName,
	initEvent = "wb-init" + selector,
	$document = wb.doc,
	defaults = {},

	/*
	* main gc-im variables
	*/
	debugMode, 		// If true, log console info
	surveyDB, 		// JSON var of data stored in invitation manager json file: imPath
	surveyScope, 	// Equals 1 if survey page and 2 if survey site
	dbURL, 			// location of im.json, example "/content/dam/canada/json/im.json"
	imPath,

	/*
	* The following variables are used for debugging with query string
	*/
	overrideScope = false, 	// Query parameter sets this to a text value to force the scope (page or site)
	overrideStart = false, 	// Query parameter sets this to true to ignore the start date of surveys
	overrideID, // Query parameter sets this to an Id value for a specific survey

	/*
	* Name of local or session storage values
	*/
	storageNames = {
		persistent: "im-invited",
		session: "im-settings"
	},

	/*
	* main function Part One - setup the survey data
	*/
	surveyDBsetup = function() {

		if ( !dbURL ) {
			return;
		}

		// Enable console logging if debug mode is turned on
		debugMode = checkEnableDebugMode();

		consoleLog( "Start" );

		// Check if any special parameters are used for testing reasons
		checkTestParams();

		consoleLog( "Check Test Params" );

		// If the user has not seen a survey
		if ( !localStorage.getItem( "lastDateIMShown" ) ) {

			consoleLog( "lastDateIMShown === null" );

			// Check if DB is already in session storage
			surveyDB = JSON.parse( sessionStorage.getItem( storageNames.session ) );

			// Download the DB if it is not already stored
			if ( !surveyDB || debugMode ) {

				consoleLog( "downloadSurveyDB" );
				downloadSurveyDB();

				// Asynchronous call, do not execute code here
			} else {
				surveySelection();
			}
		} else {	// Case when the user has already seen an invitation

			consoleLog( "User has already seen an invitation" );

			var	lastDateIMShown = new Date( localStorage.getItem( "lastDateIMShown" ) );

			if ( isStorageExpired( lastDateIMShown ) ) { // The invitation was not within the last 15 days

				sessionStorage.removeItem( "lastDateIMShown" );
				localStorage.removeItem( "lastDateIMShown" );

				downloadSurveyDB();

				surveySelection();
			}

		}

			// Asynchronous call may have been made, do not execute code here
	},

	/*
	* main function Part Two - select the survey to display
	*/
	surveySelection = function() {

		// Make sure the surveyDB object is set, it could not have been defined if
		// localStorage was not defined and the JSON file is unfound on the server
		if ( !surveyDB ) {
			return;
		}

		// At this point, we don't know if it was just downloaded or if it was
		// retrieved from session storage

		// if the DB doesn't have a scopeHat, then we need to decide on which scope hat to give
		if ( !surveyDB.settings.scopeHat ) {
			firstTimeSetup();
		}

		// Check if we need to override the scope hat
		if ( overrideScope ) {
			surveyDB.settings.scopeHat = overrideScope;
		}

		surveyScope = surveyDB.settings.scopeHat;
		consoleLog( "Scope hat = " + surveyScope + ", " + surveyDB.surveys.length + " potential surveys, removing surveys outside of date range" );

		// Delete all surveys that are outside of working dates
		var list = surveyDB.surveys;
		for ( var i = 0; i < list.length; i++ ) {
			var n = new Date().getTime();
			if ( n < new Date( list[ i ].start_date_time ).getTime() || n >= new Date( list[ i ].end_date_time ).getTime() ) {

				// If overriding start date and still before end date then don't delete this survey
				if ( overrideStart && n < new Date( list[ i ].end_date_time ).getTime() ) {
					continue;
				}

				// Splice removes the element from the array
				list.splice( i, 1 );

				//decrement i since the next record has moved to replace the current record
				i--;
			}
		}

		consoleLog( list.length + " potential surveys, removing surveys based on targeting" );

		consoleLog( list.length + " potential surveys" );

		surveyDB.surveys = list;

		// save the DB to session storage
		sessionStorage.setItem( storageNames.session, JSON.stringify( surveyDB ) );

		consoleLog( "Checking whitelist" );

		// Check if url on whitelist
		var list = getObjArr( surveyDB.settings.tbl_url_whitelist ),
			a = document.location,
			h = a.hostname + a.pathname,
			didMatch = false;

		if ( !list ) {
			return false;
		}

		for ( var i = 0; i < list.length; i++ ) {
			var b = new RegExp( list[ i ].url, "i" );

			if ( b.test( h ) ) {
				didMatch = true;
			}
		}

		if ( !didMatch ) {
			return false;
		}

		consoleLog( "Checking blacklist" );

		// Check if url is on blacklist
		var list = getObjArr( surveyDB.settings.tbl_url_blacklist ),
			a = document.location,
			h = a.hostname + a.pathname;

		for ( var i = 0; i < list.length; i++ ) {
			if ( list[ i ].url !== undefined && list[ i ].url.length !== undefined ) {
				if ( list[ i ].url.toLowerCase() === h.toLowerCase() ) {
					return false;
				}
			}
		}

		consoleLog( "Removing surveys based on page attributes" );

		// Make a deep copy of the survey DB before we remove the applicable surveys
		// This is needed because getPageAttributeMatches will delete any survey that matches from the surveyDB list
		var cpySurveys = JSON.parse( JSON.stringify( surveyDB.surveys ) );

		// b will be the index of a survey in cpySurveys that was chosen otherwise
		// it will be undefined if no survey was selected
		var b = getWeightedRandom( getPageAttributeMatches() );

		if ( b ) {
			for ( var j = 0; j < cpySurveys.length; j++ ) {

				if ( cpySurveys[ j ].id === b ) {
					var selectedSurveyIndex = j;
					break;

				}
			}

			consoleLog( "Select survey " + cpySurveys[ selectedSurveyIndex ].survey_name );

			// Show survey only if user hasn't seen it last 15 days
			var lastDateIMShown;
			var now = new Date();

			if ( localStorage.getItem( "lastDateIMShown" ) ) {
				lastDateIMShown = new Date( localStorage.getItem( "lastDateIMShown" ) );
			}

			// Persistent cookie duration is the number of days of minimal interval between 2 surveys
			if ( !isStorageExpired( lastDateIMShown ) ) {

				// Popup the survey
				invite( cpySurveys[ selectedSurveyIndex ] );

				// set the date visitor was invited
				localStorage.setItem( "lastDateIMShown", now );
			}
		} else {
			consoleLog( "No survey selected, " + surveyDB.surveys.length + " surveys remain in session storage" );

			//save the updated DB to session storage
			//the DB must be saved here since we need to remove surveys that were applicable on this page so we don't test for them again in the visit
			sessionStorage.setItem( storageNames.session, JSON.stringify( surveyDB ) );

		}
	},


	/*
	* Check if debug mode is enabled
	*/
	checkEnableDebugMode = function() {

		//Set the local storage token to remember to log console info
		if ( /[?&]logim=(true|1 )/i.test( document.location.search ) ) {
			localStorage.setItem( "dtm-logim", 1 );
		}

		if ( /[?&]logim=(false|0)/i.test( document.location.search ) ) {
			localStorage.removeItem( "dtm-logim" );
		}

		return ( localStorage.getItem( "dtm-logim" ) === 1 );
	},


	/*
	* Log console data if debug mode is enabled
	*/
	consoleLog = function( val ) {
		if ( debugMode ) {
			console.log( "Invitation Mgr: " + val );
		}
	},


	/*
	* Check if any special parameters are used for testing reasons
	*/
	checkTestParams = function() {

		// Process query parameters

		// Case of cookies
		if ( /[?&]im_nocookiecheck=1/i.test( document.location.search ) ) {
			consoleLog( "Treat visitor as new visitor (deleting locally stored data)" );

			// Delete this cookie
			sessionStorage.removeItem( "lastDateIMShown" );
			localStorage.removeItem( "lastDateIMShown" );
		}

		// Case of scope (page or site)
		if ( /[?&]im_scope=page/i.test( document.location.search ) ) {
			overrideScope = "Page";
		} else if ( /[?&]im_scope=site/i.test( document.location.search ) ) {
			overrideScope = "Entire site";
		}

		// Case of date
		if ( /[?&]im_nodatecheck=1/i.test( document.location.search ) ) {
			overrideStart = true;
		}

		// Case of Survey Id
		var b = /[?&]im_surveyid=([^?&]+)/.exec( document.location.search );
		if ( b ) {
			overrideID = b[ 1 ];
		}
	},


	/*
	* Load the survey from json file to storage
	*/
	downloadSurveyDB = function() {

		$.getJSON(
		dbURL,
		function( result ) {
			surveyDB = result;
			surveySelection();
		} );
	},


	/*
	* Take a date object as parameter and test if the storage date is expired
	*/
	isStorageExpired = function( storageDate ) {

		var now = new Date();

		if ( ( ( now - storageDate ) <= ( surveyDB.settings.persistent_cookie_duration * 86400000 ) ) || !storageDate ) {
			return false;
		}

		return true;
	},


	/*
	* First time invitation setup. We need to allocate scope hat and remove
	* surveys that don't match the scope hat
	*/
	firstTimeSetup = function() {

		// tmpSurveyDB is where we will copy all the wanted data from surveyDB
		var tmpSurveyDB = { settings: {}, surveys: [] };

		consoleLog( "Rolling probability for scope hat" );

		if ( overrideScope ) {
			surveyScope = overrideScope; // Page or Site
			consoleLog( "surveyScope = overrideScope = " + overrideScope );
		} else {
			surveyScope = getWeightedRandom( { "Page": surveyDB.settings.Page, "Entire site": surveyDB.settings.Site } );
			consoleLog( "surveyScope = getWeightedRandom = " + surveyScope );
		}

		// get an object array of all surveys in the DB
		var list = getObjArr( surveyDB.qry_active_surveys );

		consoleLog( list.length + " potential surveys, removing surveys that don't match scope hat" );

		for ( var i = 0; i < list.length; i++ ) {

			// Get only surveys that apply to this scope
			if ( list[ i ].type === surveyScope ) {

				// Copy good surveys to tmpSurveyDB
				tmpSurveyDB.surveys[ tmpSurveyDB.surveys.length ] = list[ i ];
			}
		}

		// Put all the needed settings into tmpSurveyDB
		tmpSurveyDB.settings.Page = surveyDB.settings.Page;
		tmpSurveyDB.settings.Site = surveyDB.settings.Site;
		tmpSurveyDB.settings.scopeHat = surveyScope;
		tmpSurveyDB.settings.tbl_url_whitelist = surveyDB.settings.tbl_url_whitelist;
		tmpSurveyDB.settings.tbl_url_blacklist = surveyDB.settings.tbl_url_blacklist;
		tmpSurveyDB.settings.persistent_cookie_duration = surveyDB.settings.persistent_cookie_duration;

		//set surveyDB to tmpSurveyDB so we can be sure that surveyDB is the good variable
		surveyDB = tmpSurveyDB;
	},


	/*
	* Given a JSON array of values and probabilities, output the weighted random selection.
	* For example {coffee: 0.20, tea: 0.80}
	* Output nothing if no selection is made (I.E. undefined)
	*/
	getWeightedRandom = function( spec ) {

		var i, sum = 0, r = Math.random();
		for ( i in spec ) {

			// be sure to never select something with 0% probability,
			// since Math.random() can be 0
			if ( spec[ i ] === 0 ) {
				continue;
			}

			sum += Number( spec[ i ] );
			if ( r <= sum ) {
				return i;
			}
		}
	},


	/*
	* return an object array containing the given parameter.
	* This allows us to loop through the object array whether there are 0, 1 or more objects in the array
	*/
	getObjArr = function( o ) {

		return ( typeof o === "undefined" ) ? [] : Array.isArray( o ) ? o : [ o ];
	},


	/*
	* Return a list of valid surveys based on page or site
	*/
	getPageAttributeMatches = function() {

		// Return list of valid surveys based on page / site and check if override survey id needed

		// Remove surveys that are valid from the surveyDB array so that when we save it,
		// those ones are removed and not tested on future pages in the visit

		var surveySubList = {};
		var url = ( document.location.hostname + document.location.pathname ).toLowerCase();
		var count = 0;

		for ( var i = 0; i < surveyDB.surveys.length; i++ ) {
			if ( overrideID ) {

				// Skip this loop's logic if it's not the desired survey,
				// therefore there's no chance it will be selected
				if ( surveyDB.surveys[ i ].id !== overrideID ) {
					continue;
				}

				// If it is the desired survey, set it's probability to 100.
				// Note that the desired survey must still be applicable on this page
				// so the logic in the swtich statement still must execute meet the conditions
				surveyDB.surveys[ i ].probability = 100;
			}

			switch ( surveyDB.surveys[ i ].type ) {

			case "Entire site" :

				// Get an object array of the sites to run the survey on
				var sublist = getObjArr( surveyDB.surveys[ i ].tbl_survey_sites );

				for ( var c = 0; c < sublist.length; c++ ) {

					//convert the value for the site into RegExp non-case sensitive
					var b = new RegExp( sublist[ c ].site, "i" );

					//if the url matches the regEx
					if ( b.test( url ) ) {

						// Store this survey's id and probability in the new object
						// (this object is later fed to getWeightedRandom)

						// Convert site survey probability into rate since it is
						// between 0 and Visitor Allocation for site wide type

						surveySubList[ surveyDB.surveys[ i ].id ] = surveyDB.surveys[ i ].probability * surveyDB.settings.Site;

						// Keep track of the number of surveys that apply so we can
						// console log it later
						count++;

						// Remove this survey from the DB, since we won't test for it on future pages
						surveyDB.surveys.splice( i, 1 );

						// Decrement i since the next record has moved to replace the current record
						i--;
					}
				}

				break;

			case "Page" :

				var sublist = getObjArr( surveyDB.surveys[ i ].tbl_survey_urls );

				for ( var c = 0; c < sublist.length; c++ ) {

					if ( window.location.href.toLowerCase().indexOf( sublist[ c ].url.toLowerCase() ) !== -1 && i >= 0 ) {
						surveySubList[ surveyDB.surveys[ i ].id ] = surveyDB.surveys[ i ].probability * surveyDB.settings.Page;
						count++;

						// Remove the eligible survey from the DB, since we won't test for it on future pages
						surveyDB.surveys.splice( i, 1 );

						// Decrement i since the next record has moved to replace the current record
						i--;
					}
				}

				break;
			}
		}

		consoleLog( count + " potential surveys, selecting a survey" );

		return surveySubList;
	},


	/*
	* Display the popup given the survey parameters
	*/
	invite = function( survey ) {

		var elm =
		"<aside id='gc-im-popup' class='wb-overlay wb-overlay-im modal-content-im overlay-def wb-popup-im'>" +
			"<header class='modal-header'>" +
				"<h2 class='modal-title'>" + survey[ "title-" + wb.lang ] + "</h2>" +
				"<button id='survey-close' class='mfp-close' title=" + "\"" + survey[ "close-" + wb.lang ] + "\"" + ">&times;<span class='wb-inv'> " + survey[ "close-" + wb.lang ] + "</span></button>" +
			"</header>" +
			"<div class='modal-body'>" +
				survey[ "body-" + wb.lang ] +
					"<ul class='list-inline mrgn-bttm-0'>" +
						"<li class='mrgn-tp-md'><a id='survey-yes' class='btn btn-primary' href='" + survey[ "link-" + wb.lang ] + "' target='_blank'>" + survey[ "yes-" + wb.lang ] + "</a></li>" +
						"<li class='mrgn-tp-md'><button id='survey-no' class='btn btn-default survey-close'>" + survey[ "no-" + wb.lang ] + "</button></li>" +
					"</ul>" +
				"<input type='hidden' name='popupName' value='" + survey[ "uniqueTitle" + "" ] + "'>" +
			"</div>" +
			"<div class='modal-footer  hidden'>" +
			"</div>" +
		"</aside>",

			$elm = $( elm );


		// Insert the overlay directly after the <main> element.
		$( "main" ).after( $elm );

		// trigger the open event of the overlay
		$( "#gc-im-popup" ).trigger( "open.wb-overlay" );

	},

	/**
	* @method init
	* @param {jQuery Event} event Event that triggered the function call
	*/

	init = function( event ) {


		/*
		* Start initialiZation
		* returns DOM object = proceed with init
		* returns undefined = do not proceed with init (e.g., already initialized)
		*/
		var elm = wb.init( event, componentName, selector ),
			$elm,
			settings;


		if ( elm ) {

			$elm = $( elm );
			settings = $.extend(
				true,
				{},
				defaults,
				wb.getData( $elm, componentName )
			);

			imPath = settings( "data-wb-popup-im-path" );

			// plugin initialisation

			try {

				/*
				* Make sure that local storage is available/enabled in order to continue
				*/

				var testS = "testLocalStorage";
				localStorage.setItem( testS, testS );
				localStorage.removeItem( testS );

				// If every thing is Okay
				dbURL = imPath;
				surveyDBsetup();

			} catch ( e ) {
				return false;
			}

			// Identify that initialization has completed
			wb.ready( $elm, componentName );

		}

	};


	// Close the invitation manager popup if any of its links/buttons get clicked or if the escape key gets pressed.
$( document ).on( "click vclick mouseup keydown", selector, function( event ) {

	var elm = event.currentTarget,
		$elm = $( elm );

	// Proceed if any of the overlay's links or buttons get clicked (including middle mouse clicks)
	// or if the escape key gets pressed within the overlay.
	if (
		( ( event.type === "click" || event.type === "vclick" ) && event.which === 1 && $( event.target ).closest( "a, button", this ).length ) ||
		( event.type === "mouseup" && event.which === 2 && $( event.target ).closest( "a", this ).length ) ||
		( ( event.type === "keydown" ) && ( event.which === 27 ) ) // Pressed escape key.
	) {

		// add to remove added classes to overlay when closing
		$elm
		.removeClass( "open" )
		.attr( "aria-hidden", "true" );

		// Set a flag to indicate the overlay is closing.
		// Needed to prevent IE11 (possibly also IE8-10/Edge) from failing to return
		// user focus when closing the overlay (due to a separate focusin event triggering
		// too quickly and clearing the user focus variable before it's needed).
		//overlayIsClosing = 1;

		// Hide the overlay immediately.
		$( this ).hide();


		// Remove the overlay shortly afterwards.
		// This is being done to prevent problems when the yes link is middle-clicked.
		// If the overlay were to be immediately removed, middle-clicking the yes link would remove
		// the overlay without opening the link in a new tab/window.
		// To avoid that issue, the overlay is now getting immediately hidden, then removed a short time later.
		setTimeout( function() {
			$elm.empty();
		}, 1000 );

		// Determine the cookie's new value, depending on the ID of which link/button was clicked.
		// Don't set the cookie's value to yes/no if the Esc key was pressed.
		/*if ( $( event.target ).closest( "#survey-yes", this ).length &&
			!( ( event.type === "keydown" ) && ( event.which === 27 ) ) ) {
			cookieValue = "yes";
		} else if ( $( event.target ).closest( "#survey-no", this ).length && ! ( ( event.type === "keydown" ) && ( event.which === 27 ) ) ) {
			cookieValue = "no";
		} else {
			cookieValue = "closed";
		}*/


		// Return the user's focus to where they were before the overlay stole it, then delete the user focus variable.
		// Otherwise, return the user's focus to the H1 element (or if it doesn't exist - the next element, which is likely to be main).
		// Needed to prevent browsers from unexpectedly returning focus to the top of the page
		/*if ( $userFocus ) {
			$userFocus.trigger( "setfocus.wb" );
			$userFocus = null;*/
	} else {

		// Does the H1 exist? If yes, focus to it
		// Otherwise, focus to whatever element comes after the overlay (likely main).
		if ( $( "h1" ).length ) {
			$( "h1" ).trigger( "setfocus.wb" );
		} else {
			$elm.next().trigger( "setfocus.wb" );
		}
	}

	// Remove this event handler.
	$( this ).off();

} );


/*
* Bind the init event of the plugin
*/
$document.on( "timerpoke.wb " + initEvent, selector, init );

/*
* Add the timer poke to initialize the plugin
*/
wb.add( selector );


} )( jQuery, window, wb );

// "/InvitationManager/json/PierreDubois/im.json"
