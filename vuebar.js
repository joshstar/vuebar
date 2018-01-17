/*

  TODO: Validate el1/el2 style attributes (prevent or warn about custom inline styles)
  TODO: Check again if all references (this.ins/this.state/this.config) were refactored properly
  TODO: Check of events are removed properly on destroy method
  TODO: min-height of scrollbar support
  TODO: revisit naming of state properties: especially scrollTop, barTop, barHeight
  TODO: performance: cache in state all properties that make render/reflow of document (like el2.offsetTop, etc.)
  TODO: add dragger min-height to default styles
  TODO: change name of dragger to something more fitting
  NOTE: take in consideration content height/width change between horizontal/vertical height/width calculations
  TODO: reimplement override floating scrollbar option

*/



;(function(){
  'use strict';


  /*------------------------------------*\
    Vuebar Constructor
  \*------------------------------------*/
  function Vuebar(Vue, el, binding, vnode, oldVnode){



    /*------------------------------------*\
      Config
      - Default values that may be overwritten
        on directive intialization
    \*------------------------------------*/
    this.config = {

      scrollThrottle: 10,
      draggerThrottle: 10,
      resizeRefresh: true,
      observerThrottle: 100,
      resizeDebounce: 100,
      unselectableBody: true,
      overrideFloatingScrollbar: true,
      scrollingPhantomDelay: 1000,
      draggingPhantomDelay: 1000,
      preventParentScroll: false,

      el1Class: 'vb',
      el1ScrollVisibleClass: 'vb-visible',
      el1ScrollInvisibleClass: 'vb-invisible',
      el1ScrollingClass: 'vb-scrolling',
      el1ScrollingPhantomClass: 'vb-scrolling-phantom',
      el1DraggingClass: 'vb-dragging',
      el1DraggingPhantomClass: 'vb-dragging-phantom',

      el2Class: 'vb-content',

      draggerClass: 'vb-dragger',
      draggerStylerClass: 'vb-dragger-styler',

    }



    /*------------------------------------*\
      Instances
      - This holds references to elements
        and as well to events & other stuff
      - More fitting name would probably
        be "refs", but I don't want for
        people to confuse it with Vue
        $refs property
    \*------------------------------------*/
    this.ins = {

      // reference to binding
      binding: null,

      // references to directive DOM elements
      el1: null,
      el2: null,
      dragger: null,

      // reference to MutationObserver
      mutationObserver: null,

      // references to timeouts for DOM class manipulation
      scrollingClassTimeout: null,
      draggingClassTimeout: null,
      scrollingPhantomClassTimeout: null,
      draggingPhantomClassTimeout: null,

      // references to a functions we'll need when removing events
      barMousedown: null,
      documentMousemove: null,
      documentMouseup: null,
      windowResize: null,
      scrollHandler: null,
      wheelHandler: null,

    }



    /*------------------------------------*\
      State
      - Don't confuse with Vue state!
      - This holds internal Vuebar state
        for computing positions of
        elements and scrollbar
      - Properties computed for internal
        directive logic & DOM manipulations
    \*------------------------------------*/
    this.state = {

      // constants + cached properties
      browser: null,
      nativeScrollbarSize: null,
      el2WidthToHide: null,


      // dynamic properties for y plane
      y: {
        barTop: 0, // position (top) of dragger in px
        barBaseHeight: 0, // base height of dragger in px
        barClickOffset: 0, // relative position of mouse at the time of clicking on dragger
        scrollPercent: 0, // scroll percentage on y plane
        scrollTop: 0, // position of content scrollTop in px
        visibleRatio: 0, // ratio between container height and scrollable content height
      },


      // dynamic properties for x plane
      x: {
        barLeft: 0, // position (left) of dragger in px
        barBaseWidth: 0, // base width of dragger in px
        barClickOffset: 0, // relative position of mouse at the time of clicking on dragger
        scrollPercent: 0, // scroll percentage on x plane
        scrollTop: 0,
        visibleRatio: 0, // ratio between container height and scrollable content height
      },


      // when the dragger is used - can be 'y', 'x' or false
      barDragging: false,


    }





    /*------------------------------------*\
      Validate Markup
    \*------------------------------------*/
    this.validateMarkup = function(){
      if (!el.firstChild) {
        return this.util.warn('Element 1 with v-bar directive doesn\'t have required child element 2.');
      }
      return true;
    }






    /*------------------------------------*\
      Initialize Sub Methods
      - These methods gets called only once
        on initialize()
    \*------------------------------------*/

    // options
    this.initializeOptions = function(){
      // get options object & overwrite defaults with provided options
      // - it will come from directive binding (there is a 'value' property)
      // - or it will come from public method direct options object
      var options = binding.value ? binding.value : (binding ? binding : {});
      for (var key in options){
        this.config[key] = options[key];
      }
    }


    // create and reference event listeners
    this.initializeEvents = function(){

      // create and reference event listeners
      this.ins.barMousedown = this.barMousedown();
      this.ins.documentMousemove = this.documentMousemove();
      this.ins.documentMouseup = this.documentMouseup();
      this.ins.windowResize = this.windowResize();
      this.ins.scrollHandler = this.scrollHandler();
      this.ins.wheelHandler = this.wheelHandler();

      // add events
      // - wheel event is only needed when preventParentScroll option is enabled
      // - resize event is only needed when resizeRefresh option is enabled
      this.ins.el2.addEventListener('scroll', this.ins.scrollHandler, 0);
      this.ins.dragger.addEventListener('mousedown', this.ins.barMousedown, 0);
      this.config.preventParentScroll ? this.ins.el2.addEventListener('wheel', this.ins.wheelHandler, 0) : null;
      this.config.resizeRefresh ? window.addEventListener('resize', this.ins.windowResize, 0) : null;

    }



    // setup element styles and classess
    this.initializeStyles = function(){

      // el1 styles and class
      this.util.aC(this.ins.el1, this.config.el1Class);
      this.ins.el1.style.position = 'relative';
      this.ins.el1.style.overflow = 'hidden';

      // el2 styles and class
      this.util.aC(this.ins.el2, this.config.el2Class);
      this.util.cS(this.ins.el2, 'BoxSizing', 'content-box');
      this.ins.el2.style.display = 'block';
      this.ins.el2.style.overflowX = 'hidden';
      this.ins.el2.style.overflowY = 'scroll';
      this.ins.el2.style.height = '100%';

      // how much of el2 to hide... if native scrollbar width is 0 it's either overlay scrollbar or hidden
      // ... so let's use constant of 20px because it's impossible (?) to calculate scrollbar width in this case
      // and 20px is a safe value that should cover 99% of cases (PRs welcome!)
      var widthToHide = this.state.nativeScrollbarSize ? this.state.nativeScrollbarSize : 20;

      // do the magic
      // hide el2 scrollbar by making it larger than el1 overflow boundaries
      if (this.state.y.visibleRatio<1){
        this.ins.el2.style.marginRight = '-' + widthToHide + 'px';
      }

      // add padding to overlayed/0 scrollbars, so the proper el2 content won't get cut off
      if ((this.state.y.visibleRatio<1) && (this.state.nativeScrollbarSize===0)) {
        this.ins.el2.style.paddingRight = '20px';
      }

    }






    /*------------------------------------*\
      Initialize Scrollbar
    \*------------------------------------*/
    this.initialize = function(){

      // safeguard to not initialize vuebar when it's already initialized
      if (el.$_vuebar) return this.util.warn('Can\'t initialize on already initialized element.');

      // validate on directive bind if the markup is OK
      if (!this.validateMarkup()) return;

      // initialize options...
      this.initializeOptions();

      // detect browser
      this.state.browser = this.util.detectBrowser();

      //  native scrollbar size
      this.state.nativeScrollbarSize = this.util.getNativeScrollbarSize(el.firstElementChild);

      // add binding and els to state
      this.ins.binding = binding.value ? binding : null;
      this.ins.el1 = el;
      this.ins.el2 = el.firstElementChild;

      // create dragger
      this.ins.dragger = this.createDragger();

      // initialize events...
      this.initializeEvents();

      // initialize and reference mutation observer
      this.ins.mutationObserver = this.createMutationObserver();

      // initialize styles...
      this.initializeStyles();

      // expose instance on vuebar element (https://vuejs.org/v2/style-guide/#Private-property-names-essential)
      this.ins.el1.$_vuebar = this;

      // initial calculations using refresh scrollbar
      this.refresh({immediate: true});

      // return instance
      return this;

    }




    /*------------------------------------*\
      Destroy Scrollbar
    \*------------------------------------*/
    this.destroy = function(options){
      var options = options ? options : {};

      // clear events
      this.ins.dragger.removeEventListener('mousedown', this.ins.barMousedown, 0);
      this.ins.el2.removeEventListener('scroll', this.ins.scrollHandler, 0);
      this.ins.el2.removeEventListener('wheel', this.ins.scrollHandler, 0);
      window.removeEventListener('resize', this.ins.windowResize, 0);

      // disconnect mutation observer
      this.ins.mutationObserver ? this.ins.mutationObserver.disconnect() : null;

      // clear el1 classes
      this.util.rC(this.ins.el1, this.config.el1Class);
      this.util.rC(this.ins.el1, this.config.el1ScrollVisibleClass);
      this.util.rC(this.ins.el1, this.config.el1ScrollInvisibleClass);
      this.util.rC(this.ins.el1, this.config.el1ScrollingClass);
      this.util.rC(this.ins.el1, this.config.el1ScrollingPhantomClass);
      this.util.rC(this.ins.el1, this.config.el1DraggingClass);

      // clear el1 styles
      if (!options.skipStyles) {
        this.ins.el1.style.position = '';
        this.ins.el1.style.overflow = '';
      }

      // clear el2 classes
      this.util.rC(this.ins.el2, this.config.el2Class);

      // clear el2 styles
      if (!options.skipStyles) {
        this.ins.el2.style.boxSizing = '';
        this.ins.el2.style.display = '';
        this.ins.el2.style.overflowX = '';
        this.ins.el2.style.overflowY = '';
        this.ins.el2.style.height = '';
        //this.ins.el2.style.width = '';
        this.ins.el2.style.marginRight = '';
        this.ins.el2.style.paddingRight = '';
      }

      // clear dragger
      this.ins.dragger.removeChild(this.ins.dragger.firstChild);
      this.ins.el1.removeChild(this.ins.dragger);

      // clear timeouts that may be still running
      this.ins.scrollingPhantomClassTimeout ?
      clearTimeout(this.ins.scrollingPhantomClassTimeout) : null;
      this.ins.draggingPhantomClassTimeout ?
      clearTimeout(this.ins.draggingPhantomClassTimeout) : null;

      // delete instance from vuebar element
      delete this.ins.el1.$_vuebar;

      // return el1 (not sure why, but why not)
      return this.ins.el1;

    }





    /*------------------------------------*\
      Refresh Scrollbar
    \*------------------------------------*/
    this.refresh = function(options){
      var options = options ? options : {};
      if (options.immediate) {
        this.computeVisibleRatio();
        this.computeBarTopOnScroll();
        this.computeBarBaseHeight();
        this.updateDragger();
      }
      Vue.nextTick(function(){
        if (!el.$_vuebar) return;
        this.computeVisibleRatio();
        this.computeBarTopOnScroll();
        this.computeBarBaseHeight();
        this.updateDragger();
      }.bind(this));
    }














    /*------------------------------------*\
      Computing Properties
    \*------------------------------------*/

    this.computeVisibleRatio = function(){
      this.state.y.visibleRatio = (this.ins.el2.clientHeight / this.ins.el2.scrollHeight);
    }


    //this.computeScrollTop = function(){
    //  this.state.y.scrollTop = this.state.y.barTop * (this.ins.el2.scrollHeight / this.ins.el2.clientHeight);
    //}

    this.computeScrollTop = function(){

      // calculate scroll percentage...
      // I SPENT 5 HOURS to come up with these 2 lines below - lets say I've suffered "writer's block" =) / Dom
      var barHeight = this.ins.dragger.offsetHeight;
      this.state.y.scrollPercent = this.state.y.barTop / (this.ins.el2.clientHeight - barHeight);

      // convert scroll percentage to scrollTop pixels
      var availablePixels = (this.ins.el2.scrollHeight - this.ins.el2.clientHeight);
      var scrollTop = availablePixels * this.state.y.scrollPercent;

      //console.table({
      //  barHeight: barHeight,
      //  scrollPercent: (this.state.y.scrollPercent*100)+'%',
      //  el2ScrollHeight: this.ins.el2.scrollHeight,
      //  el2ClientHeight: this.ins.el2.clientHeight,
      //  availablePixels: availablePixels,
      //  scrollTop: scrollTop,
      //});

      this.state.y.scrollTop = scrollTop;
    }


    this.computeBarBaseHeight = function(){
      if (this.state.y.visibleRatio >= 1) {
        this.state.y.barBaseHeight = 0;
      } else {
        this.state.y.barBaseHeight = this.ins.el2.clientHeight * this.state.y.visibleRatio;
      }
    }




    this.computeBarTopOnDrag = function(event){

      // get bar height
      var barHeight = this.ins.dragger.offsetHeight;

      // get relative mouse y position (mouse position - el1 offset from window)
      var relativeMouseY = (event.clientY - this.ins.el1.getBoundingClientRect().top);

      // if bar is trying to go over top
      if (relativeMouseY <= this.state.y.barClickOffset) {
        this.state.y.barTop = 0;
      }

      // alternative: if bar is trying to go over top
      //if (this.state.y.scrollPercent <= 0.0) {
      //  this.state.y.barTop = 0;
      //}

      // if bar is moving between top and bottom
      if (relativeMouseY > this.state.y.barClickOffset) {
        this.state.y.barTop = relativeMouseY - this.state.y.barClickOffset;
      }

      // if bar is trying to go over bottom
      if ( (this.state.y.barTop + barHeight ) >= this.ins.el2.clientHeight ) {
        this.state.y.barTop = this.ins.el2.clientHeight - barHeight;
      }

      // debug
      //this.state.y.barTop = relativeMouseY - this.state.y.barClickOffset;

    }




    this.computeBarTopOnScroll = function(){
      var scrollPercent = this.ins.el2.scrollTop / (this.ins.el2.scrollHeight - this.ins.el2.clientHeight);
      var availablePixels = (this.ins.el2.clientHeight - this.ins.dragger.offsetHeight);
      this.state.y.barTop = availablePixels * scrollPercent;
    }








    /*------------------------------------*\
      Styles & DOM
    \*------------------------------------*/
    this.createDragger = function(){

      var dragger = document.createElement('div');
      var draggerStyler = document.createElement('div');

      dragger.className = this.config.draggerClass;

      dragger.style.position = 'absolute';

      draggerStyler.className = this.config.draggerStylerClass;

      dragger.appendChild(draggerStyler);
      this.ins.el1.appendChild(dragger);

      return dragger;
    }


    this.updateDragger = function(options){
      var options = options ? options : {};

      // setting dragger styles
      this.ins.dragger.style.height = parseInt(Math.round(this.state.y.barBaseHeight)) + 'px';
      this.ins.dragger.style.top = parseInt(Math.round(this.state.y.barTop)) + 'px';
      //this.ins.dragger.style.height = Math.ceil( this.state.y.barBaseHeight ) + 'px';
      //this.ins.dragger.style.top = Math.ceil( this.state.y.barTop ) + 'px';

      // scrollbar visible / invisible classes
      if (this.state.y.visibleRatio<1) {
        this.util.rC(this.ins.el1, this.config.el1ScrollInvisibleClass);
        this.util.aC(this.ins.el1, this.config.el1ScrollVisibleClass);
      } else {
        this.util.rC(this.ins.el1, this.config.el1ScrollVisibleClass);
        this.util.aC(this.ins.el1, this.config.el1ScrollInvisibleClass);
      }



      if (options.withScrollingClasses) {

        // add scrolling class
        this.util.aC(this.ins.el1, this.config.el1ScrollingClass);

        // remove scrolling class
        this.ins.scrollingClassTimeout ?
        clearTimeout(this.ins.scrollingClassTimeout) : null;

        this.ins.scrollingClassTimeout = setTimeout(function() {
          this.util.rC(this.ins.el1, this.config.el1ScrollingClass);
        }.bind(this), this.config.scrollThrottle + 5);



        // add phantom scrolling class
        this.util.aC(this.ins.el1, this.config.el1ScrollingPhantomClass);

        // remove phantom scrolling class
        this.ins.scrollingPhantomClassTimeout ?
        clearTimeout(this.ins.scrollingPhantomClassTimeout) : null;
        this.ins.scrollingPhantomClassTimeout = setTimeout(function() {
          this.util.rC(this.ins.el1, this.config.el1ScrollingPhantomClass);
        }.bind(this), this.config.scrollThrottle + this.config.scrollingPhantomDelay);

      }

    }




    this.preventParentScroll = function(event){

      if (this.state.y.visibleRatio >= 1) {
        return false;
      }

      var scrollDist = this.ins.el2.scrollHeight - this.ins.el2.clientHeight;
      var scrollTop = this.ins.el2.scrollTop;

      var wheelingUp = event.deltaY < 0;
      var wheelingDown = event.deltaY > 0;

      if ( (scrollTop <= 0) && wheelingUp) {
        event.preventDefault();
        return false;
      }

      if ( (scrollTop >= scrollDist) && wheelingDown) {
        event.preventDefault();
        return false;
      }

    }



    this.updateScroll = function(){
      this.ins.el2.scrollTop = this.state.y.scrollTop;
    }







    /*------------------------------------*\
      Events & Handlers
    \*------------------------------------*/

    this.scrollHandler = function(){
      return this.util.throttle(function(event){
        this.computeVisibleRatio();
        this.computeBarBaseHeight(); // fallback for an undetected content change
        if (!this.state.barDragging) {
          this.computeBarTopOnScroll();
          this.updateDragger({withScrollingClasses: true});
        }
      }.bind(this), this.config.scrollThrottle);
    }


    this.wheelHandler = function(){
      return function(event){
        this.preventParentScroll(event);
      }.bind(this);
    }


    this.documentMousemove = function(){
      return this.util.throttle(function(event){
        this.computeBarTopOnDrag(event);
        this.updateDragger();
        this.computeScrollTop();
        this.updateScroll();
      }.bind(this), this.config.draggerThrottle);
    }


    this.documentMouseup = function(){
      return function(event){

        //
        this.state.barDragging = false;

        // enable user select
        this.ins.el1.style.userSelect = '';
        this.config.unselectableBody ? this.util.cS(document.body, 'UserSelect', '') : null;

        // remove dragging class
        this.util.rC(this.ins.el1, this.config.el1DraggingClass);
        this.ins.draggingPhantomClassTimeout = setTimeout(function() {
          this.util.rC(this.ins.el1, this.config.el1DraggingPhantomClass);
        }.bind(this), this.config.draggingPhantomDelay);


        // remove events
        document.removeEventListener('mousemove', this.ins.documentMousemove, 0);
        document.removeEventListener('mouseup', this.ins.documentMouseup, 0);

      }.bind(this);

    }


    this.barMousedown = function(){
      return function(event){

        // don't do nothing if it's not left mouse button
        if ( event.which!==1 ) { return false }

        this.state.barDragging = true;
        this.state.y.barClickOffset = event.offsetY;

        // disable user select
        this.ins.el1.style.userSelect = 'none';
        this.config.unselectableBody ? this.util.cS(document.body, 'UserSelect', 'none') : null;

        // add dragging class
        this.util.aC(this.ins.el1, this.config.el1DraggingClass);
        this.ins.draggingPhantomClassTimeout ?
        clearTimeout(this.ins.draggingPhantomClassTimeout) : null;
        this.util.aC(this.ins.el1, this.config.el1DraggingPhantomClass);

        // add events
        document.addEventListener('mousemove', this.ins.documentMousemove, 0);
        document.addEventListener('mouseup', this.ins.documentMouseup, 0);

      }.bind(this);
    }


    this.windowResize = function(){
      return this.util.debounce(function(event){
        this.refresh();
      }.bind(this), this.config.resizeDebounce);
    }




    this.createMutationObserver = function(){
      if (typeof MutationObserver === typeof void 0) { return null }

      var observer = new MutationObserver(this.util.throttle(function(mutations) {
        this.refresh();
      }.bind(this), this.config.observerThrottle));

      observer.observe(this.ins.el2, {
        childList: true,
        characterData: true,
        subtree: true,
      });

      return observer;
    }








    /*------------------------------------*\
      Convenience Methods
      - Warning! Don't use yet.
      - This method API will change.
    \*------------------------------------*/
    this.scrollTo = function(positionY, positionX){
      // TODO: scroll to top
      // TODO: scroll to bottom
      // TODO: scroll to child element
      // TODO: scroll to position
      // TODO: scroll by specific amount of distance
      // TODO: smoothly animated scroll
      if (!positionY) return this.util.warn('[scrollTo]: You need to specify position to scroll.');
      if (positionY === 'top') { this.ins.el2.scrollTop = 0; }
      else if (positionY === 'bottom') { this.ins.el2.scrollTop = this.ins.el2.scrollHeight; }
      else {
        this.ins.el2.scrollTop = positionY;
        this.ins.el2.scrollLeft = positionX;
      }
    }











    /*------------------------------------*\
      Utils
    \*------------------------------------*/
    this.util = {


      /*------------------------------------*\
        Warning
      \*------------------------------------*/
      warn: function(message){
        var message = '[Vuebar]: ' + message;
        return Vue.util && Vue.util.warn ? Vue.util.warn(message) : window.console.warn(message);
      },



      /*------------------------------------*\
        Debounce Helper
        https://remysharp.com/2010/07/21/throttling-function-calls
      \*------------------------------------*/
      debounce: function(fn, delay) {
        var timer = null;
        return function () {
          var context = this, args = arguments;
          clearTimeout(timer);
          timer = setTimeout(function () {
            fn.apply(context, args);
          }, delay);
        };
      },



      /*------------------------------------*\
        Throttle Helper
        https://remysharp.com/2010/07/21/throttling-function-calls
      \*------------------------------------*/
      throttle: function(fn, threshhold, scope) {
        threshhold || (threshhold = 250);
        var last,
        deferTimer;
        return function () {
          var context = scope || this;

          var now = +new Date,
          args = arguments;
          if (last && now < last + threshhold) {
            // hold on to it
            clearTimeout(deferTimer);
            deferTimer = setTimeout(function () {
              last = now;
              fn.apply(context, args);
            }, threshhold);
          } else {
            last = now;
            fn.apply(context, args);
          }
        }
      },




      /*------------------------------------*\
        [C]ompat [S]tyle
        Style Vendor Prefixes Helper
      \*------------------------------------*/
      cS: function(element, property, value) {
        element.style['webkit' + property] = value;
        element.style['moz' + property] = value;
        element.style['ms' + property] = value;
        element.style['o' + property] = value;
        element.style[ property.slice(0,1).toLowerCase() + property.substring(1) ] = value;
      },



      /*------------------------------------*\
        Class Manipulation Helpers
        https://plainjs.com/javascript/attributes/adding-removing-and-testing-for-classes-9/
      \*------------------------------------*/

      // hasClass
      hC: function(el, classToCheck) {
        if (el.classLists) { return el.classList.contains(classToCheck); }
        else { return (new RegExp('\\b'+ classToCheck+'\\b')).test(el.className); }
      },

      // addClass
      aC: function(el, classToAdd) {
        var hC = this.util ? this.util.hC : this.hC; // fix for < ie9
        if (el.classList) { el.classList.add(classToAdd); }
        else if (!hC(el, classToAdd)) { el.className += ' ' + classToAdd };
      },

      // removeClass
      rC: function(el, classToRemove) {
        if (el.classList) el.classList.remove(classToRemove);
        else el.className = el.className.replace(new RegExp('\\b'+ classToRemove+'\\b', 'g'), '');
      },





      /*------------------------------------*\
        Browser Detection Helper
      \*------------------------------------*/
      detectBrowser: function(){

        // get ie version helper
        function getIEVersion() {
          var match = window.navigator.userAgent.match(/(?:MSIE |Trident\/.*; rv:)(\d+)/);
          return match ? parseInt(match[1]) : void 0;
        }

        // user agent & vendor
        var ua = window.navigator.userAgent;
        var vendor = window.navigator.vendor;

        // chrome
        var chrome = (
          (ua.toLowerCase().indexOf('chrome') > -1) && (vendor.toLowerCase().indexOf('google') > -1)
        );

        // edge
        var edge = ua.indexOf('Edge') > -1;

        // safari
        var safari = !!window.safari || ((ua.toLowerCase().indexOf('safari') > -1) && (vendor.toLowerCase().indexOf('apple') > -1));

        // internet explorer
        var ie8 = getIEVersion() == 8;
        var ie9 = getIEVersion() == 9;
        var ie10 = getIEVersion() == 10;
        var ie11 = getIEVersion() == 11;
        var ie = ie8 || ie9 || ie10 || ie11;

        // is it mobile browser?
        // regex below thanks to http://detectmobilebrowsers.com/
        var uaOrVendor = ua || vendor || window.opera;
        var mobile = (/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(uaOrVendor)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(uaOrVendor.substr(0,4)));

        // construct return object
        return {
          edge: edge,
          chrome: chrome,
          safari: safari,
          mobile: mobile,
          ie: ie,
          ie8: ie8,
          ie9: ie9,
          ie10: ie10,
          ie11: ie11,
        };

      },


      /*------------------------------------*\
        Calculate scrollbar size (width) in element
        - if the size is 0 it means the scrollbar is floated/overlayed
        - accepts "container" paremeter because ie & edge can have different
        scrollbar behaviors for different elements using '-ms-overflow-style'
        - useful: https://gist.github.com/paulirish/5d52fb081b3570c81e3a
      \*------------------------------------*/
      getNativeScrollbarSize: function(container) {
        var container = container ? container : document.body;

        var fullWidth = 0;
        var barWidth = 0;

        var wrapper = document.createElement('div');
        var child = document.createElement('div');

        wrapper.style.display = 'block';
        wrapper.style.boxSizing = 'content-box';
        wrapper.style.position = 'absolute';
        wrapper.style.pointerEvents = 'none';
        wrapper.style.opacity = '0';
        wrapper.style.bottom = '0';
        wrapper.style.right = '0';
        wrapper.style.width = '100px';
        wrapper.style.height = '10px';
        wrapper.style.overflow = 'hidden';

        wrapper.appendChild(child);
        container.appendChild(wrapper);

        fullWidth = child.offsetWidth;

        wrapper.style.overflowY = 'scroll';

        // fix for safari https://github.com/DominikSerafin/vuebar/pull/45
        child.style.height = '20px';
        child.style.width = '100%';

        barWidth = fullWidth - child.offsetWidth;

        container.removeChild(wrapper);

        console.dir(barWidth);
        return barWidth;
      },


    }





  }






  /*------------------------------------*\
    Vuebar For Installation
  \*------------------------------------*/
  function VuebarPlugin(Vue, options){


    /*------------------------------------*\
      Public Methods Install
    \*------------------------------------*/
    Vue.$_Vuebar = Vuebar;
    Vue.prototype.$_Vuebar = Vuebar;



    /*------------------------------------*\
      Directive Install
    \*------------------------------------*/
    Vue.directive('bar', {

      inserted: function(el, binding, vnode){
        (new Vuebar(Vue, el, binding, vnode)).initialize();
      },

      componentUpdated: function(el, binding, vnode, oldVnode){
        el.$_vuebar ? el.$_vuebar.refresh() : null;
      },

      unbind: function(el, binding, vnode, oldVnode){
        // we shouldn't clear styles because it actually doesn't matter that much
        // the element will be always deleted on unbind and its styles also
        // and if we do clear styles then it looks bad on transitions
        el.$_vuebar ? el.$_vuebar.destroyScrollbar({skipStyles: true}) : null;
      },

    });

  }


  /*------------------------------------*\
    Expose / Autoinstall
  \*------------------------------------*/
  if (typeof exports === 'object' && typeof module === 'object') {
    module.exports = VuebarPlugin;
  } else if (typeof define === 'function' && define.amd) {
    define(function () { return VuebarPlugin });
  } else if (typeof window !== typeof void 0) {
    window.Vuebar = VuebarPlugin;
  }

  if (typeof Vue !== typeof void 0) {
    Vue.use(VuebarPlugin);
  }


})();
