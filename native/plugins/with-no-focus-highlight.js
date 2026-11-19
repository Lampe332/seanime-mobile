// No grey focus box (4.2.0 E). Android draws its default focus highlight, a grey rectangle over the view's whole bounds,
// on the focused view while the device is out of touch mode (after a key from a keyboard, `adb shell input text`, a
// D-pad). When a text field lets go of the focus (components/ui/core/page-focus.ts: a page left behind releases its
// field), Android hands the focus to the first focusable view of the window: the magnifier of Home's head, which then
// kept a square grey box after the way back to Home (S22). React Native's views are drawn round by the app and show
// their own pressed state; the square highlight never fits them. The app theme turns it off (API 26+).
const { withAndroidStyles, AndroidConfig } = require('expo/config-plugins');

const NAME = 'android:defaultFocusHighlightEnabled';

function withoutFocusHighlight(styles) {
  return AndroidConfig.Styles.assignStylesValue(styles, {
    add: true,
    parent: AndroidConfig.Styles.getAppThemeGroup(),
    name: NAME,
    value: 'false',
    targetApi: '26',
  });
}

module.exports = function withNoFocusHighlight(config) {
  return withAndroidStyles(config, (mod) => {
    mod.modResults = withoutFocusHighlight(mod.modResults);
    return mod;
  });
};
module.exports.withoutFocusHighlight = withoutFocusHighlight;
