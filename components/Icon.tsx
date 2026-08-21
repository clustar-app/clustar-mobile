import { Feather, AntDesign, Ionicons } from "@expo/vector-icons";
import { StyleProp, TextStyle } from "react-native";
import { colors } from "@/lib/theme";

// Central icon component so we can swap sets or resize globally.
// The mockup uses lucide-react icons via `data-i` attributes. Feather
// (from @expo/vector-icons, bundled with Expo — no install) is the closest
// visual match to lucide. A few icons (heart-filled, ghost) come from
// AntDesign/Ionicons where Feather doesn't have them.

export type IconName =
  | "pin"          // clustar location
  | "nav"          // moving anchor
  | "users"        // participants
  | "heart"        // like (outline)
  | "heart-fill"   // like (filled)
  | "repeat"       // repost
  | "clock"        // time-remaining
  | "comment"      // reply count
  | "mask"         // anon / burner
  | "radar"        // empty feed
  | "search"       // search
  | "back"         // navigation
  | "close"        // dismiss
  | "send"         // reply composer
  | "plus"         // create / add image
  | "image"        // image picker
  | "more"         // overflow menu
  | "check"        // success
  | "mail"         // email
  | "phone"        // phone
  | "eye"          // reveal
  | "camera"       // take photo
  | "trash"        // delete / remove
  | "chevron-down"
  | "chevron-up";

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}

export function Icon({ name, size = 16, color = colors.t2, style }: Props) {
  switch (name) {
    case "pin":         return <Feather name="map-pin" size={size} color={color} style={style} />;
    case "nav":         return <Feather name="navigation" size={size} color={color} style={style} />;
    case "users":       return <Feather name="users" size={size} color={color} style={style} />;
    case "heart":       return <Feather name="heart" size={size} color={color} style={style} />;
    case "heart-fill":  return <AntDesign name="heart" size={size} color={color} style={style} />;
    case "repeat":      return <Feather name="repeat" size={size} color={color} style={style} />;
    case "clock":       return <Feather name="clock" size={size} color={color} style={style} />;
    case "comment":     return <Feather name="message-circle" size={size} color={color} style={style} />;
    case "mask":        return <Ionicons name="person-outline" size={size} color={color} style={style} />;
    case "radar":       return <Feather name="radio" size={size} color={color} style={style} />;
    case "search":      return <Feather name="search" size={size} color={color} style={style} />;
    case "back":        return <Feather name="chevron-left" size={size} color={color} style={style} />;
    case "close":       return <Feather name="x" size={size} color={color} style={style} />;
    case "send":        return <Feather name="send" size={size} color={color} style={style} />;
    case "plus":        return <Feather name="plus" size={size} color={color} style={style} />;
    case "image":       return <Feather name="image" size={size} color={color} style={style} />;
    case "more":        return <Feather name="more-horizontal" size={size} color={color} style={style} />;
    case "check":       return <Feather name="check" size={size} color={color} style={style} />;
    case "mail":        return <Feather name="mail" size={size} color={color} style={style} />;
    case "phone":       return <Feather name="phone" size={size} color={color} style={style} />;
    case "chevron-down": return <Feather name="chevron-down" size={size} color={color} style={style} />;
    case "chevron-up":   return <Feather name="chevron-up" size={size} color={color} style={style} />;
    case "eye":          return <Feather name="eye" size={size} color={color} style={style} />;
    case "camera":       return <Feather name="camera" size={size} color={color} style={style} />;
    case "trash":        return <Feather name="trash-2" size={size} color={color} style={style} />;
  }
}
