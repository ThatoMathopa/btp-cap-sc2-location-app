sap.ui.define([
  'sap/ui/core/UIComponent',
  'sap/ui/Device'
], (UIComponent, Device) => {
  'use strict';

  return UIComponent.extend('com.company.locationmashup', {
    metadata: { manifest: 'json' },
    init() {
      UIComponent.prototype.init.apply(this, arguments);
      this.getRouter().initialize();
    },
    getContentDensityClass() {
      return Device.support.touch ? 'sapUiSizeCozy' : 'sapUiSizeCompact';
    }
  });
});
