#filter substitution
/*
# -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*-
# ***** BEGIN LICENSE BLOCK *****
# Version: MPL 1.1/GPL 2.0/LGPL 2.1
#
# The contents of this file are subject to the Mozilla Public License Version
# 1.1 (the "License"); you may not use this file except in compliance with
# the License. You may obtain a copy of the License at
# http://www.mozilla.org/MPL/
#
# Software distributed under the License is distributed on an "AS IS" basis,
# WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
# for the specific language governing rights and limitations under the
# License.
#
# The Original Code is Mozilla Prism.
#
# The Initial Developer of the Original Code is
# Mark Finkle.
#
# Contributor(s):
# Mark Finkle, <mark.finkle@gmail.com>, <mfinkle@mozilla.com>
# Matthew Gertner, <matthew.gertner@gmail.com>
# Fredrik Larsson <nossralf@gmail.com>
#
# Alternatively, the contents of this file may be used under the terms of
# either the GNU General Public License Version 2 or later (the "GPL"), or
# the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
# in which case the provisions of the GPL or the LGPL are applicable instead
# of those above. If you wish to allow use of your version of this file only
# under the terms of either the GPL or the LGPL, and not to allow others to
# use your version of this file under the terms of the MPL, indicate your
# decision by deleting the provisions above and replace them with the notice
# and other provisions required by the GPL or the LGPL. If you do not delete
# the provisions above, a recipient may use your version of this file under
# the terms of any one of the MPL, the GPL or the LGPL.
#
# ***** END LICENSE BLOCK *****
*/

const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://prism/modules/WebAppProperties.jsm");
Components.utils.import("resource://prism/modules/ImageUtils.jsm");
Components.utils.import("resource://prism/modules/WebAppInstall.jsm");
Components.utils.import("resource://prism/modules/FaviconDownloader.jsm");

var InstallShortcut = {
  _advanced : {},
  _userIcon : null,
  _iframe : null,
  _mode : "edit",
  _oncomplete : false,
  _faviconDownloader : new FaviconDownloader,

  init : function() {
    var self = this;

    // Check the dialog mode
    this._mode = (window.arguments && window.arguments.length == 2) ? "install" : "edit";
    this._oncomplete = (window.arguments && window.arguments.length == 2) ? window.arguments[1] : null;

    // Default the UI from the given config
    if (WebAppProperties.uri) {
      document.getElementById("uri").value = WebAppProperties.uri;
      var name = document.getElementById("name");
      name.focus();
    
      // Fetch the favicon since we have a URI, only if this is not a webapp bundle
      if (!WebAppProperties.appBundle) {
        setTimeout(function() { self.onUriChange(); }, 100);
      }
    }

    if (WebAppProperties.name) {
      name.value = WebAppProperties.name;
      name.select();
    }

    // Default to use the favicon
    document.getElementById("icon_favicon").setAttribute("checked", "true");

    if (this._mode == "install") {
      var bundle = Cc["@mozilla.org/intl/stringbundle;1"].getService(Ci.nsIStringBundleService);
      bundle = bundle.createBundle("chrome://@PACKAGE@/locale/install-shortcut.properties");
      document.title = bundle.GetStringFromName("dialog.title");
      document.getElementById("row_uri").hidden = false;
      document.getElementById("options").hidden = false;

      document.getElementById("status").checked = WebAppProperties.status;
      document.getElementById("location").checked = WebAppProperties.location;
      document.getElementById("navigation").checked = WebAppProperties.navigation;
      document.getElementById("trayicon").checked = WebAppProperties.trayicon;

      document.getElementById("uri").addEventListener("change", function() { self.onUriChange(); }, false);

      window.arguments[1].value = true;

      // Display the default application icon
      this.onIconReady();
    }

    // Configure the options based on the OS
#ifdef XP_MACOSX
    document.getElementById("programs").hidden = true;
    document.getElementById("quicklaunch").hidden = true;
    document.getElementById("trayicon").hidden = true;
#else
#ifdef XP_UNIX
    document.getElementById("programs").hidden = true;
    document.getElementById("quicklaunch").hidden = true;
    document.getElementById("trayicon").hidden = true;

    document.getElementById("applications").hidden = true;
#else
    document.getElementById("applications").hidden = true;
#endif
#endif
  },

  cleanup: function() {
    if (this._iframe)
    {
      this._iframe.removeEventListener("DOMLinkAdded", this._faviconDownloader, false);
      this._iframe.removeEventListener("DOMContentLoaded", this._faviconDownloader, false);
    }
  },
  
  /**
   * Get the user-selected locations for the shortcuts.
   */
  _determineShortcuts: function IS__determine_shortcuts(doc, bundle) {
    var shortcuts = "";
    if (doc.getElementById("desktop").checked)
      shortcuts += "desktop,";
    if (doc.getElementById("programs").checked)
      shortcuts += "programs,";
    if (doc.getElementById("quicklaunch").checked)
      shortcuts += "quicklaunch,";
    if (doc.getElementById("applications").checked)
      shortcuts += "applications,";

    if (shortcuts.length == 0) {
      alert(bundle.GetStringFromName("shortcuts.missing"));
      return null;
    }
    
    return shortcuts;
  },

  accept : function() {
    var retObj = this._handleAccept();
    return retObj ? this.shortcutCreated(retObj.shortcut, retObj.params) : false;
  },
    
  _handleAccept : function() { 
    var bundle = Cc["@mozilla.org/intl/stringbundle;1"].getService(Ci.nsIStringBundleService);
    bundle = bundle.createBundle("chrome://@PACKAGE@/locale/install-shortcut.properties");

    var name = document.getElementById("name").value;

    // Trim leading / trailing spaces
    name = name.replace(/^\s+/, "").replace(/\s+$/, "");
    if (name.length == 0) {
      document.getElementById("name").focus();
      alert(bundle.GetStringFromName("name.missing"));
      return null;
    }

    // Check for invalid characters (mainly Windows)
    if (/([\\*:?<>|\/\"])/.test(name)) {
      document.getElementById("name").focus();
      alert(bundle.GetStringFromName("name.invalid"));
      return null;
    }
    
    var shortcuts = this._determineShortcuts(document, bundle);
    if (!shortcuts) {
      return null;
    }

    var programs = document.getElementById("programs");
    var uri = document.getElementById("uri");
    var doLocation = document.getElementById("location").checked ? true : false;
    var doStatus = document.getElementById("status").checked ? true : false;
    var doNavigation = document.getElementById("navigation").checked ? true : false;
    var doTrayIcon = document.getElementById("trayicon").checked ? true : false;

    // Start transforming the name into the ID
    var idPrefix = name.toLowerCase();

    // Replace spaces with dots for file system safety
    idPrefix = idPrefix.replace(/ /g, ".");

    // Remove other invalid characters that are fine for shortcut name, but bad for ID
    idPrefix = idPrefix.replace(/[\'\(\)\#\~\&\;\`\!\%]/g, "");

    // Get the icon stream which is either the default icon or the favicon
    var iconData = this.getIcon();
    if (iconData.mimeType != ImageUtils.getNativeIconMimeType()) {
      try {
        this.convertIconToNative(iconData);
      }
      catch(e) {
        // Couldn't convert icon to native format for some reason. We'll have to use the default icon.
        var bundle = Cc["@mozilla.org/intl/stringbundle;1"].getService(Ci.nsIStringBundleService);
        bundle = bundle.createBundle("chrome://@PACKAGE@/locale/install-shortcut.properties");
        var alertTitle = bundle.GetStringFromName("iconDialog.couldntConvertTitle");
        var alertText = bundle.GetStringFromName("iconDialog.couldntConvert");
        var promptService = Cc["@mozilla.org/embedcomp/prompt-service;1"].getService(Ci.nsIPromptService);
        promptService.alert(window, alertTitle, alertText);

        this.useDefaultIcon(iconData);
        this.convertIconToNative(iconData);
      }
    }

    var params = {
        id: idPrefix + "@prism.app", 
        name: name, 
        uri: uri.value, 
        icon: iconData, 
        status: doStatus, 
        location: doLocation, 
        sidebar: "false", 
        navigation: doNavigation, 
        trayicon: doTrayIcon};

    // Use the id from the bundle, if we have one
    if (WebAppProperties.appBundle) {
      params.id = WebAppProperties.id;
    }

    // Setup the app group
    if (this._advanced.hasOwnProperty("group"))
      params["group"] = this._advanced.group;
    else
      params["group"] = name;

    // Update the caller's config
    WebAppProperties.id = params.id;
    WebAppProperties.uri = params.uri;
    WebAppProperties.name = params.name;
    WebAppProperties.status = params.status;
    WebAppProperties.location = params.location;
    WebAppProperties.navigation = params.navigation;
    WebAppProperties.trayicon = params.trayicon;

    // Make any desired shortcuts
    var shortcut = WebAppInstall.createShortcut(name, WebAppProperties.id, shortcuts.split(","));
    
    return {shortcut: shortcut, params: params};
  },
  
  shortcutCreated : function(shortcut, params, mode)  {
    if (this._mode == "install") {
      // If a webapp bundle was preinstalled, don't clean the folder. We want to
      // overwrite only some files. For non-webapp bundles, clean the folder.
      var clean = (WebAppProperties.appBundle == null);

      // Make the web application in the profile folder
      WebAppInstall.createApplication(params, clean);
    }
    if (this._oncomplete) {
        return this._oncomplete(WebAppInstall, WebAppProperties.id, shortcut);
    }
  },
  

  getIcon : function()
  {
    var icon = { mimeType: null, stream: null };

    if (this._userIcon) {
      icon.mimeType = this._userIcon.mimeType;
      icon.stream = this._userIcon.storage.newInputStream(0);
      return icon;
    }

    var favicon = this._faviconDownloader.imageStream;
    if (favicon) {
      icon.stream = favicon;
      icon.mimeType = this._faviconDownloader.mimeType;
      return icon;
    }

    if (WebAppProperties.appBundle) {
      var iconName = WebAppProperties.icon + ImageUtils.getNativeIconExtension();
      var defaultIcon = WebAppProperties.appBundle.clone();
      defaultIcon.append("icons");
      defaultIcon.append("default");
      defaultIcon.append(iconName);

      var inputStream = Cc["@mozilla.org/network/file-input-stream;1"].
                        createInstance(Ci.nsIFileInputStream);
      inputStream.init(defaultIcon, 0x01, 00004, null);

      // Create an in memory stream to hold the image data. We can't count on the
      // file existing until it's time to create application.
      var storageStream = ImageUtils.createStorageStream();
      var bufferedOutput = ImageUtils.getBufferedOutputStream(storageStream);
      bufferedOutput.writeFrom(inputStream, inputStream.available());
      bufferedOutput.flush();

      icon.stream = storageStream.newInputStream(0);
      icon.mimeType = ImageUtils.getNativeIconMimeType();
    }
    else {
      this.useDefaultIcon(icon);
    }

    return icon;
  },

  onUriChange : function(event)
  {
    // Show the user that we are doing something
    var image = document.getElementById("icon");
    image.setAttribute("src", ImageUtils.getNativeThrobberSpec());

    // Try to get the page and see if there is a <link> tag for the favicon
    if (!this._iframe)
    {
      this._iframe = document.createElement("iframe");
      this._iframe.setAttribute("collapsed", true);
      this._iframe.setAttribute("type", "content");

      document.documentElement.appendChild(this._iframe);
    }

    // If anything is loading in the iframe, stop it
    // This includes about:blank if we just created the iframe
    var webNav = this._iframe.docShell.QueryInterface(Ci.nsIWebNavigation);
    webNav.stop(Ci.nsIWebNavigation.STOP_NETWORK);

    this._iframe.docShell.allowJavascript = false;
    this._iframe.docShell.allowAuth = false;
    this._iframe.docShell.allowPlugins = false;
    this._iframe.docShell.allowMetaRedirects = false;
    this._iframe.docShell.allowSubframes = false;
    this._iframe.docShell.allowImages = false;

    // Prepare the URI to look for favicon
    var uriFixup = Cc["@mozilla.org/docshell/urifixup;1"].getService(Ci.nsIURIFixup);
    var uri = uriFixup.createFixupURI(document.getElementById("uri").value, Ci.nsIURIFixup.FIXUP_FLAG_NONE);

    var self = this;
    this._faviconDownloader.startDownload(uri, this._iframe, function() { self.onIconReady(); });
  },

  onIconReady : function() {
    var icon = this.getIcon();
    var iconDataURI = ImageUtils.makeDataURL(icon.stream, icon.mimeType);
    var image = document.getElementById("icon");
    image.setAttribute("src", iconDataURI);
  },

  useDefaultIcon : function(icon) {
    var ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
    var channel = ioService.newChannel("resource://prism/chrome/icons/default/app.png", "", null);

    icon.stream = channel.open();
    icon.mimeType = "image/png";
  },

  useFavicon : function() {
    this._userIcon = null;
    this.onIconReady();
  },

  useFile : function() {
    var fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);

    var bundle = Cc["@mozilla.org/intl/stringbundle;1"].getService(Ci.nsIStringBundleService);
    bundle = bundle.createBundle("chrome://@PACKAGE@/locale/install-shortcut.properties");
    var title = bundle.GetStringFromName("iconDialog.title");
    fp.init(window, title, Ci.nsIFilePicker.modeOpen);

    fp.appendFilters(Ci.nsIFilePicker.filterImages);
    if (fp.show() == Ci.nsIFilePicker.returnOK) {
      var inputStream = Cc["@mozilla.org/network/file-input-stream;1"].
      createInstance(Ci.nsIFileInputStream);
      inputStream.init(fp.file, 0x01, 00004, null);

      var storageStream = ImageUtils.createStorageStream();
      var bufferedOutput = ImageUtils.getBufferedOutputStream(storageStream);
      bufferedOutput.writeFrom(inputStream, inputStream.available());
      bufferedOutput.flush();

      var fileName = fp.file.leafName;
      var fileExt = fileName.substring(fileName.lastIndexOf("."), fileName.length).toLowerCase();
      var fileMimeType = ImageUtils.getMimeTypeFromExtension(fileExt);

      this._userIcon = { mimeType: fileMimeType, storage: storageStream };

      this.onIconReady();
    }
  },

  convertIconToNative : function(iconData) {
    var storageStream = ImageUtils.createStorageStream();
    ImageUtils.createNativeIcon(iconData.stream, iconData.mimeType, ImageUtils.getBufferedOutputStream(storageStream));
    iconData. mimeType = ImageUtils.getNativeIconMimeType();
    iconData.stream = storageStream.newInputStream(0);
  },

  advancedSettings : function() {
    window.openDialog("chrome://@PACKAGE@/content/install-advanced.xul", "settings", "centerscreen,modal", this._advanced);
  }
};
